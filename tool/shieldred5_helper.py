#!/usr/bin/env python3
"""
ShieldRed 5 cross-platform disk partition, FAT16, and XZ helper.

Provides pure-Python replacements for ShieldRed 5 native CLI (fat, gpt, partresize)
plus block-aligned MBR/GPT layout writers for Linux and macOS installers.
"""

import argparse
import lzma
import os
import re
import stat
import struct
import sys
import uuid
import zlib

SECTOR_SIZE = 512
SIZE_1MB = 1024 * 1024
SHIELDRED5_EFI_PART_SIZE = 32 * SIZE_1MB
SHIELDRED5_EFI_PART_SECTORS = SHIELDRED5_EFI_PART_SIZE // SECTOR_SIZE
SHIELDRED5_EFI_PART_ATTR = 0x8000000000000000
MS_BASIC_DATA_GUID = uuid.UUID("ebd0a0a2-b9e5-4433-87c0-68b6b72699c7").bytes_le


def sfn_checksum(sfn11: bytes) -> int:
    """Compute FAT LFN short-filename 8-bit checksum."""
    chk = 0
    for b in sfn11:
        chk = (((chk & 1) << 7) + (chk >> 1) + b) & 0xFF
    return chk


def is_valid_83_upper(name: str) -> bytes | None:
    """Return 11-byte FAT 8.3 representation if name fits strictly in uppercase 8.3."""
    if not name or name in (".", ".."):
        return None
    if name.count(".") > 1 or " " in name:
        return None
    parts = name.split(".")
    base = parts[0]
    ext = parts[1] if len(parts) == 2 else ""
    if not (1 <= len(base) <= 8) or len(ext) > 3:
        return None
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$%'-_@~`!(){}^#&")
    if any(c not in allowed for c in base + ext):
        return None
    return (base.ljust(8) + ext.ljust(3)).encode("ascii")


def make_sfn(name: str, existing_sfns: set[bytes]) -> bytes:
    """Generate a unique uppercase 8.3 short name for LFN directory entry creation."""
    exact = is_valid_83_upper(name)
    if exact and exact not in existing_sfns:
        return exact
    clean = re.sub(r"[^A-Z0-9$%'\-_@~`!(){}^#&.]", "_", name.upper()).lstrip(".")
    if "." in clean:
        base, ext = clean.rsplit(".", 1)
    else:
        base, ext = clean, ""
    base = base.replace(".", "") or "FILE"
    ext = re.sub(r"[^A-Z0-9$%'\-_@~`!(){}^#&]", "_", ext)[:3].ljust(3)
    for n in range(1, 1000):
        suffix = f"~{n}"
        stem = (base[: max(1, 8 - len(suffix))] + suffix).ljust(8)
        cand = (stem + ext).encode("ascii")
        if cand not in existing_sfns:
            return cand
    raise RuntimeError(f"Could not allocate 8.3 short name for {name!r}")


class RawBlockDevice:
    """Block/character device or image file wrapper with block-aligned R/W."""

    def __init__(self, path: str, write: bool = False):
        self.path = path
        self.write_mode = write
        flags = os.O_RDWR if write else os.O_RDONLY
        if hasattr(os, "O_BINARY"):
            flags |= os.O_BINARY
        self.fd = os.open(path, flags)
        try:
            st = os.fstat(self.fd)
            self.is_char = stat.S_ISCHR(st.st_mode)
            # macOS raw character devices (/dev/rdiskN) require physical block alignment
            self.align = 4096 if self.is_char else SECTOR_SIZE
            self.size = self._detect_size(st)
        except Exception:
            os.close(self.fd)
            raise

    def _detect_size(self, st: os.stat_result) -> int:
        if stat.S_ISREG(st.st_mode):
            return st.st_size
        # For block/char devices: lseek SEEK_END works on Linux; on macOS may return 0 or actual size
        cur = os.lseek(self.fd, 0, os.SEEK_SET)
        end = os.lseek(self.fd, 0, os.SEEK_END)
        os.lseek(self.fd, cur, os.SEEK_SET)
        if end > 0:
            return end
        # Fallback for macOS /dev/diskN or /dev/rdiskN via ioctl DKIOCGETBLOCKCOUNT/SIZE
        if sys.platform == "darwin":
            import fcntl

            DKIOCGETBLOCKSIZE = 0x40046418
            DKIOCGETBLOCKCOUNT = 0x40086419
            blk_sz = struct.unpack("I", fcntl.ioctl(self.fd, DKIOCGETBLOCKSIZE, b"\x00" * 4))[0]
            blk_cnt = struct.unpack("Q", fcntl.ioctl(self.fd, DKIOCGETBLOCKCOUNT, b"\x00" * 8))[0]
            self.align = max(blk_sz, SECTOR_SIZE)
            return blk_sz * blk_cnt
        raise OSError(f"Cannot determine size of {self.path}")

    def close(self) -> None:
        if self.fd >= 0:
            if self.write_mode:
                try:
                    os.fsync(self.fd)
                except OSError:
                    pass
            os.close(self.fd)
            self.fd = -1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def _pread_exact(self, offset: int, length: int) -> bytes:
        chunks = []
        rem = length
        pos = offset
        while rem > 0:
            if hasattr(os, "pread"):
                data = os.pread(self.fd, rem, pos)
            else:
                os.lseek(self.fd, pos, os.SEEK_SET)
                data = os.read(self.fd, rem)
            if not data:
                raise EOFError(f"Unexpected EOF reading {self.path} at {pos}")
            chunks.append(data)
            pos += len(data)
            rem -= len(data)
        return b"".join(chunks)

    def _pwrite_exact(self, offset: int, data: bytes) -> None:
        view = memoryview(data)
        written = 0
        while written < len(data):
            if hasattr(os, "pwrite"):
                n = os.pwrite(self.fd, view[written:], offset + written)
            else:
                os.lseek(self.fd, offset + written, os.SEEK_SET)
                n = os.write(self.fd, view[written:])
            if n <= 0:
                raise OSError(f"Short write on {self.path} at {offset + written}")
            written += n

    def read_at(self, offset: int, length: int) -> bytes:
        if length == 0:
            return b""
        align = self.align
        if offset % align == 0 and length % align == 0:
            return self._pread_exact(offset, length)
        a_start = (offset // align) * align
        a_end = ((offset + length + align - 1) // align) * align
        raw = self._pread_exact(a_start, a_end - a_start)
        delta = offset - a_start
        return raw[delta : delta + length]

    def write_at(self, offset: int, data: bytes) -> None:
        if not self.write_mode:
            raise PermissionError(f"Device {self.path} opened read-only")
        if not data:
            return
        align = self.align
        length = len(data)
        if offset % align == 0 and length % align == 0:
            self._pwrite_exact(offset, data)
            return
        a_start = (offset // align) * align
        a_end = ((offset + length + align - 1) // align) * align
        buf = bytearray(self._pread_exact(a_start, a_end - a_start))
        delta = offset - a_start
        buf[delta : delta + length] = data
        self._pwrite_exact(a_start, bytes(buf))


class Fat16Volume:
    """Minimal pure-Python FAT16 reader/writer with LFN support."""

    def __init__(self, dev: RawBlockDevice, part_offset: int = 0):
        self.dev = dev
        self.base = part_offset
        bpb = dev.read_at(part_offset, 512)
        if bpb[510:512] != b"\x55\xaa":
            raise ValueError("Missing FAT boot sector 0x55AA signature")
        (
            self.bps,
            self.spc,
            self.rsv,
            self.nfats,
            self.nroot,
            totsec16,
            _media,
            self.fsz,
            _spt,
            _heads,
            _hidden,
            totsec32,
        ) = struct.unpack_from("<HBHBHHBHHHII", bpb, 11)
        if self.bps != 512 or self.spc == 0 or self.nfats == 0 or self.fsz == 0:
            raise ValueError("Unsupported or invalid FAT16 BPB geometry")
        self.totsec = totsec16 if totsec16 != 0 else totsec32
        self.root_sectors = ((self.nroot * 32) + self.bps - 1) // self.bps
        self.fat_offset = self.rsv * self.bps
        self.fat_bytes = self.fsz * self.bps
        self.root_offset = self.fat_offset + (self.nfats * self.fat_bytes)
        self.data_offset = self.root_offset + (self.root_sectors * self.bps)
        data_sectors = self.totsec - (self.rsv + self.nfats * self.fsz + self.root_sectors)
        self.total_clusters = data_sectors // self.spc
        if not (4085 <= self.total_clusters < 65525):
            raise ValueError(f"Partition is not FAT16 (clusters={self.total_clusters})")
        self.fat = bytearray(dev.read_at(self.base + self.fat_offset, self.fat_bytes))

    def sync_fat(self) -> None:
        for i in range(self.nfats):
            off = self.base + self.fat_offset + i * self.fat_bytes
            self.dev.write_at(off, bytes(self.fat))

    def _get_fat(self, cluster: int) -> int:
        return struct.unpack_from("<H", self.fat, cluster * 2)[0]

    def _set_fat(self, cluster: int, val: int) -> None:
        struct.pack_into("<H", self.fat, cluster * 2, val & 0xFFFF)

    def _cluster_offset(self, cluster: int) -> int:
        return self.base + self.data_offset + ((cluster - 2) * self.spc * self.bps)

    def _cluster_bytes(self) -> int:
        return self.spc * self.bps

    def _read_cluster_chain(self, start_cluster: int) -> bytearray:
        out = bytearray()
        c = start_cluster
        seen = set()
        csz = self._cluster_bytes()
        while 2 <= c < 0xFFF8:
            if c in seen or c >= self.total_clusters + 2:
                raise ValueError(f"Corrupt FAT16 cluster chain at {c}")
            seen.add(c)
            out.extend(self.dev.read_at(self._cluster_offset(c), csz))
            c = self._get_fat(c)
        return out

    def _free_chain(self, start_cluster: int) -> None:
        c = start_cluster
        seen = set()
        while 2 <= c < 0xFFF8:
            if c in seen or c >= self.total_clusters + 2:
                break
            seen.add(c)
            nxt = self._get_fat(c)
            self._set_fat(c, 0x0000)
            c = nxt

    def _alloc_clusters(self, count: int) -> list[int]:
        if count <= 0:
            return []
        alloc = []
        max_c = self.total_clusters + 2
        for c in range(2, max_c):
            if self._get_fat(c) == 0:
                alloc.append(c)
                if len(alloc) == count:
                    break
        if len(alloc) < count:
            raise OSError("FAT16 partition out of space")
        for idx, c in enumerate(alloc):
            nxt = alloc[idx + 1] if idx + 1 < len(alloc) else 0xFFFF
            self._set_fat(c, nxt)
        return alloc

    def _read_dir_bytes(self, dir_cluster: int) -> tuple[bytearray, list[int]]:
        if dir_cluster == 0:
            return bytearray(self.dev.read_at(self.base + self.root_offset, self.root_sectors * self.bps)), []
        clusters = []
        c = dir_cluster
        seen = set()
        out = bytearray()
        csz = self._cluster_bytes()
        while 2 <= c < 0xFFF8:
            if c in seen:
                break
            seen.add(c)
            clusters.append(c)
            out.extend(self.dev.read_at(self._cluster_offset(c), csz))
            c = self._get_fat(c)
        return out, clusters

    def _write_dir_bytes(self, dir_cluster: int, clusters: list[int], buf: bytearray) -> None:
        if dir_cluster == 0:
            self.dev.write_at(self.base + self.root_offset, bytes(buf))
            return
        csz = self._cluster_bytes()
        assert len(buf) == len(clusters) * csz
        for idx, c in enumerate(clusters):
            self.dev.write_at(self._cluster_offset(c), bytes(buf[idx * csz : (idx + 1) * csz]))

    @staticmethod
    def _decode_sfn(raw11: bytes) -> str:
        name = raw11[:8].decode("ascii", errors="replace").rstrip(" ")
        ext = raw11[8:11].decode("ascii", errors="replace").rstrip(" ")
        return f"{name}.{ext}" if ext else name

    @staticmethod
    def _decode_lfn_chunk(entry: bytes) -> str:
        raw = entry[1:11] + entry[14:26] + entry[28:32]
        chars = []
        for i in range(0, 26, 2):
            code = struct.unpack_from("<H", raw, i)[0]
            if code in (0x0000, 0xFFFF):
                break
            chars.append(chr(code))
        return "".join(chars)

    def _list_dir_slots(self, dir_cluster: int):
        buf, clusters = self._read_dir_bytes(dir_cluster)
        entries = []
        lfn_parts: list[tuple[int, bytes, str]] = []
        n_slots = len(buf) // 32
        for slot in range(n_slots):
            ent = bytes(buf[slot * 32 : (slot + 1) * 32])
            first = ent[0]
            if first == 0x00:
                break
            if first == 0xE5:
                lfn_parts.clear()
                continue
            attr = ent[11]
            if attr == 0x0F:
                lfn_parts.append((slot, ent, self._decode_lfn_chunk(ent)))
                continue
            if attr & 0x08:  # volume label
                lfn_parts.clear()
                continue
            sfn11 = ent[:11]
            sfn_name = self._decode_sfn(sfn11)
            lfn_slots = []
            long_name = sfn_name
            if lfn_parts:
                chk = sfn_checksum(sfn11)
                if all(p[1][13] == chk for p in lfn_parts):
                    long_name = "".join(p[2] for p in reversed(lfn_parts))
                    lfn_slots = [p[0] for p in lfn_parts]
            lfn_parts.clear()
            fst_clus = struct.unpack_from("<H", ent, 26)[0]
            fsize = struct.unpack_from("<I", ent, 28)[0]
            entries.append(
                {
                    "name": long_name,
                    "sfn_name": sfn_name,
                    "sfn11": sfn11,
                    "attr": attr,
                    "cluster": fst_clus,
                    "size": fsize,
                    "slot": slot,
                    "lfn_slots": lfn_slots,
                }
            )
        return entries, buf, clusters

    def _find_parent(self, path: str) -> tuple[int, str]:
        parts = [p for p in path.strip("/").split("/") if p]
        if not parts:
            raise ValueError(f"Invalid FAT path: {path}")
        cur_cluster = 0
        for comp in parts[:-1]:
            entries, _, _ = self._list_dir_slots(cur_cluster)
            hit = next((e for e in entries if e["name"].lower() == comp.lower() or e["sfn_name"].lower() == comp.lower()), None)
            if not hit or not (hit["attr"] & 0x10):
                raise FileNotFoundError(f"Directory not found in FAT16: {path}")
            cur_cluster = hit["cluster"]
        return cur_cluster, parts[-1]

    def read_file(self, path: str) -> bytes:
        dir_cluster, fname = self._find_parent(path)
        entries, _, _ = self._list_dir_slots(dir_cluster)
        hit = next((e for e in entries if e["name"].lower() == fname.lower() or e["sfn_name"].lower() == fname.lower()), None)
        if not hit or (hit["attr"] & 0x10):
            raise FileNotFoundError(f"File not found in FAT16: {path}")
        if hit["size"] == 0 or hit["cluster"] < 2:
            return b""
        data = self._read_cluster_chain(hit["cluster"])
        return bytes(data[: hit["size"]])

    def exists(self, path: str) -> bool:
        try:
            dir_cluster, fname = self._find_parent(path)
            entries, _, _ = self._list_dir_slots(dir_cluster)
            return any(e["name"].lower() == fname.lower() or e["sfn_name"].lower() == fname.lower() for e in entries)
        except FileNotFoundError:
            return False

    def delete_file(self, path: str) -> bool:
        try:
            dir_cluster, fname = self._find_parent(path)
        except FileNotFoundError:
            return False
        entries, buf, clusters = self._list_dir_slots(dir_cluster)
        hit = next((e for e in entries if e["name"].lower() == fname.lower() or e["sfn_name"].lower() == fname.lower()), None)
        if not hit or (hit["attr"] & 0x10):
            return False
        if hit["cluster"] >= 2:
            self._free_chain(hit["cluster"])
            self.sync_fat()
        for slot in hit["lfn_slots"] + [hit["slot"]]:
            buf[slot * 32] = 0xE5
        self._write_dir_bytes(dir_cluster, clusters, buf)
        return True

    def write_file(self, path: str, data: bytes) -> None:
        self.delete_file(path)
        dir_cluster, fname = self._find_parent(path)
        entries, buf, clusters = self._list_dir_slots(dir_cluster)
        existing_sfns = {e["sfn11"] for e in entries}

        exact_sfn = is_valid_83_upper(fname)
        lfn_entries: list[bytes] = []
        if exact_sfn and exact_sfn not in existing_sfns:
            sfn11 = exact_sfn
        else:
            sfn11 = make_sfn(fname, existing_sfns)
            chk = sfn_checksum(sfn11)
            utf16 = [ord(c) for c in fname] + [0x0000]
            while len(utf16) % 13 != 0:
                utf16.append(0xFFFF)
            n_lfn = len(utf16) // 13
            for seq in range(n_lfn, 0, -1):
                chunk = utf16[(seq - 1) * 13 : seq * 13]
                seq_byte = seq | (0x40 if seq == n_lfn else 0)
                packed = (
                    bytes([seq_byte])
                    + struct.pack("<5H", *chunk[0:5])
                    + b"\x0f\x00"
                    + bytes([chk])
                    + struct.pack("<6H", *chunk[5:11])
                    + b"\x00\x00"
                    + struct.pack("<2H", *chunk[11:13])
                )
                lfn_entries.append(packed)

        needed_slots = len(lfn_entries) + 1
        csz = self._cluster_bytes()
        data_clusters = self._alloc_clusters((len(data) + csz - 1) // csz) if data else []
        for idx, c in enumerate(data_clusters):
            block = data[idx * csz : (idx + 1) * csz]
            if len(block) < csz:
                block = block + b"\x00" * (csz - len(block))
            self.dev.write_at(self._cluster_offset(c), block)
        if data_clusters:
            self.sync_fat()

        # Find contiguous free slots: either needed_slots consecutive 0xE5 entries,
        # or starting at an end-of-directory (0x00) marker (re-terminating after our write).
        total_slots = len(buf) // 32
        start_slot = None
        eod_slot = None
        terminating = False
        run = 0
        for s in range(total_slots):
            b0 = buf[s * 32]
            if b0 == 0x00:
                eod_slot = s
                if total_slots - s >= needed_slots:
                    start_slot = s
                    terminating = True
                break
            elif b0 == 0xE5:
                run += 1
                if run == needed_slots:
                    start_slot = s - needed_slots + 1
                    break
            else:
                run = 0
        if start_slot is None:
            if dir_cluster == 0:
                raise OSError("FAT16 root directory full")
            new_c = self._alloc_clusters(1)[0]
            self._set_fat(clusters[-1], new_c)
            self.sync_fat()
            clusters.append(new_c)
            start_slot = eod_slot if eod_slot is not None else total_slots
            terminating = True
            buf.extend(b"\x00" * csz)
            buf[start_slot * 32 :] = b"\x00" * (len(buf) - start_slot * 32)

        sfn_entry = bytearray(32)
        sfn_entry[0:11] = sfn11
        sfn_entry[11] = 0x20  # archive
        struct.pack_into("<H", sfn_entry, 26, data_clusters[0] if data_clusters else 0)
        struct.pack_into("<I", sfn_entry, 28, len(data))

        all_new = lfn_entries + [bytes(sfn_entry)]
        for i, raw_ent in enumerate(all_new):
            slot = start_slot + i
            buf[slot * 32 : (slot + 1) * 32] = raw_ent
        if terminating and (start_slot + needed_slots) < (len(buf) // 32):
            buf[(start_slot + needed_slots) * 32] = 0x00
        self._write_dir_bytes(dir_cluster, clusters, buf)


def fill_mbr_location(disk_size_bytes: int, start_lba: int, sector_count: int) -> bytes:
    """Pack a 16-byte MBR partition entry using ShieldRed 5 CHS calculation."""
    n_sector = 63
    n_head = 8
    total_secs = disk_size_bytes // SECTOR_SIZE
    while n_head < 256 and (total_secs // n_sector // n_head) > 1024:
        n_head *= 2
    if n_head >= 256:
        n_head = 255

    def encode_chs(lba: int) -> tuple[int, int, int]:
        cyl = min(1023, lba // n_sector // n_head)
        head = (lba // n_sector) % n_head
        sec = (lba % n_sector) + 1
        return head & 0xFF, sec & 0x3F, cyl & 0x3FF

    sh, ss, sc = encode_chs(start_lba)
    end_lba = start_lba + sector_count - 1
    eh, es, ec = encode_chs(end_lba)
    return struct.pack(
        "<BBBBBBBBII",
        0x00,
        sh,
        ss | ((sc >> 8) << 6),
        sc & 0xFF,
        0x00,
        eh,
        es | ((ec >> 8) << 6),
        ec & 0xFF,
        start_lba & 0xFFFFFFFF,
        sector_count & 0xFFFFFFFF,
    )


def strip_secure_boot_fat16(dev: RawBlockDevice, part2_start_lba: int) -> None:
    """Replace signed EFI shims on Partition 2 FAT16 with unsigned GRUB binaries."""
    fat = Fat16Volume(dev, part2_start_lba * SECTOR_SIZE)
    x64 = fat.read_file("/EFI/BOOT/grubx64_real.efi")
    for p in (
        "/EFI/BOOT/BOOTX64.EFI",
        "/EFI/BOOT/grubx64.efi",
        "/EFI/BOOT/grubx64_real.efi",
        "/EFI/BOOT/MokManager.efi",
        "/EFI/BOOT/mmx64.efi",
        "/ENROLL_THIS_KEY_IN_MOKMANAGER.cer",
    ):
        fat.delete_file(p)
    fat.write_file("/EFI/BOOT/BOOTX64.EFI", x64)

    try:
        ia32 = fat.read_file("/EFI/BOOT/grubia32_real.efi")
    except FileNotFoundError:
        ia32 = None
    if ia32 is not None:
        for p in (
            "/EFI/BOOT/BOOTIA32.EFI",
            "/EFI/BOOT/grubia32.efi",
            "/EFI/BOOT/grubia32_real.efi",
            "/EFI/BOOT/mmia32.efi",
        ):
            fat.delete_file(p)
        fat.write_file("/EFI/BOOT/BOOTIA32.EFI", ia32)


def is_gpt_disk(mbr_hdr_bytes: bytes) -> bool:
    return mbr_hdr_bytes[450] == 0xEE and mbr_hdr_bytes[512:520] == b"EFI PART"


def update_gpt_crcs(gpt_33_sectors: bytearray, backup_header: bytearray | None = None) -> None:
    """Recompute Partition Table CRC and Header CRC in-place for primary & backup GPT."""
    tbl_crc = zlib.crc32(gpt_33_sectors[512 : 512 + 128 * 128]) & 0xFFFFFFFF
    struct.pack_into("<I", gpt_33_sectors, 88, tbl_crc)
    struct.pack_into("<I", gpt_33_sectors, 16, 0)
    hdr_len = struct.unpack_from("<I", gpt_33_sectors, 12)[0]
    hdr_crc = zlib.crc32(gpt_33_sectors[:hdr_len]) & 0xFFFFFFFF
    struct.pack_into("<I", gpt_33_sectors, 16, hdr_crc)

    if backup_header is not None:
        struct.pack_into("<I", backup_header, 88, tbl_crc)
        struct.pack_into("<I", backup_header, 16, 0)
        bhdr_crc = zlib.crc32(backup_header[:hdr_len]) & 0xFFFFFFFF
        struct.pack_into("<I", backup_header, 16, bhdr_crc)


def make_gpt_header(
    my_lba: int,
    alt_lba: int,
    first_usable: int,
    last_usable: int,
    disk_guid: bytes,
    part_tbl_lba: int,
) -> bytearray:
    hdr = bytearray(512)
    hdr[0:8] = b"EFI PART"
    hdr[8:12] = b"\x00\x00\x01\x00"
    struct.pack_into("<I", hdr, 12, 92)
    struct.pack_into("<QQQQ", hdr, 24, my_lba, alt_lba, first_usable, last_usable)
    hdr[56:72] = disk_guid
    struct.pack_into("<QIII", hdr, 72, part_tbl_lba, 128, 128, 0)
    return hdr


def cmd_write_layout(args) -> int:
    """Write fresh ShieldRed 5 MBR or GPT partition table + boot/core/EFI images."""
    disk_path = args.disk
    with RawBlockDevice(disk_path, write=True) as dev:
        total_sectors = dev.size // SECTOR_SIZE
        reserved_sectors = (args.reserve_mb * SIZE_1MB) // SECTOR_SIZE
        part2_sectors = SHIELDRED5_EFI_PART_SECTORS
        align_4k = args.align_4k

        usable_end = total_sectors - (33 if args.style == "gpt" else 0) - reserved_sectors
        part2_start = usable_end - part2_sectors
        if align_4k:
            part2_start = (part2_start // 8) * 8
        part1_start = 2048
        part1_sectors = part2_start - part1_start
        if part1_sectors < 2048:
            print("Disk is too small for ShieldRed 5 layout", file=sys.stderr)
            return 1

        # Load boot.img (446 bytes) & decompress core.img.xz & shieldred5.disk.img.xz
        with open(args.boot_img, "rb") as f:
            boot_img = f.read()
        if len(boot_img) < 446:
            print(f"Invalid boot.img: {args.boot_img}", file=sys.stderr)
            return 1
        with lzma.open(args.core_img_xz, "rb") as f:
            core_img = f.read()
        with lzma.open(args.disk_img_xz, "rb") as f:
            efi_img = f.read()

        if args.style == "mbr":
            mbr = bytearray(512)
            mbr[0:446] = boot_img[:446]
            p1 = bytearray(fill_mbr_location(dev.size, part1_start, part1_sectors))
            p1[0] = 0x80
            p1[4] = args.mbr_type
            p2 = bytearray(fill_mbr_location(dev.size, part2_start, part2_sectors))
            p2[0] = 0x00
            p2[4] = 0xEF
            mbr[446:462] = p1
            mbr[462:478] = p2
            mbr[510:512] = b"\x55\xaa"
            dev.write_at(0, bytes(mbr))
            dev.write_at(SECTOR_SIZE, core_img[: 2047 * SECTOR_SIZE])
        else:
            disk_guid = uuid.uuid4().bytes_le
            mbr = bytearray(512)
            mbr[0:440] = boot_img[:440]
            prot_secs = min(0xFFFFFFFF, total_sectors - 1)
            mbr[446:462] = struct.pack("<BBBBBBBBII", 0x00, 0x00, 0x02, 0x00, 0xEE, 0xFF, 0xFF, 0xFF, 1, prot_secs)
            mbr[510:512] = b"\x55\xaa"

            part_tbl = bytearray(128 * 128)
            label_u16 = (args.label[:35]).encode("utf-16-le")
            # Part 1: user data
            part_tbl[0:16] = MS_BASIC_DATA_GUID
            part_tbl[16:32] = uuid.uuid4().bytes_le
            struct.pack_into("<QQQ", part_tbl, 32, part1_start, part1_start + part1_sectors - 1, 0)
            part_tbl[56 : 56 + len(label_u16)] = label_u16
            # Part 2: VTOYEFI
            p2off = 128
            part_tbl[p2off : p2off + 16] = MS_BASIC_DATA_GUID
            part_tbl[p2off + 16 : p2off + 32] = uuid.uuid4().bytes_le
            struct.pack_into("<QQQ", part_tbl, p2off + 32, part2_start, part2_start + part2_sectors - 1, SHIELDRED5_EFI_PART_ATTR)
            vtoye = "VTOYEFI".encode("utf-16-le")
            part_tbl[p2off + 56 : p2off + 56 + len(vtoye)] = vtoye

            first_usable = 34
            last_usable = total_sectors - 34
            prim_hdr = make_gpt_header(1, total_sectors - 1, first_usable, last_usable, disk_guid, 2)
            back_hdr = make_gpt_header(total_sectors - 1, 1, first_usable, last_usable, disk_guid, total_sectors - 33)

            prim_33 = prim_hdr + part_tbl
            update_gpt_crcs(prim_33, back_hdr)

            dev.write_at(0, bytes(mbr) + bytes(prim_33))
            dev.write_at(34 * SECTOR_SIZE, core_img[: 2014 * SECTOR_SIZE])
            dev.write_at((total_sectors - 33) * SECTOR_SIZE, bytes(part_tbl) + bytes(back_hdr))

        dev.write_at(part2_start * SECTOR_SIZE, efi_img[: SHIELDRED5_EFI_PART_SIZE])
        if not args.secure_boot:
            strip_secure_boot_fat16(dev, part2_start)

        print(f"PART1_START={part1_start} PART1_SECTORS={part1_sectors} PART2_START={part2_start} PART2_SECTORS={part2_sectors}")
    return 0


def cmd_fat(args) -> int:
    if args.test:
        return 0
    with RawBlockDevice(args.target, write=False) as dev:
        fat = Fat16Volume(dev, args.offset * SECTOR_SIZE)
        if args.secure_boot_check:
            return 0 if fat.exists("/EFI/BOOT/grubx64_real.efi") else 1
        cfg = fat.read_file("/grub/grub.cfg").decode("utf-8", errors="replace")
        m = re.search(r'VENTOY_VERSION\s*=\s*"?([^"\r\n]+)"?', cfg)
        if not m:
            return 1
        print(m.group(1).strip())
        return 0


def cmd_gpt_fix(args) -> int:
    with RawBlockDevice(args.disk, write=True) as dev:
        buf = dev.read_at(0, 34 * SECTOR_SIZE)
        if not is_gpt_disk(buf):
            return 0
        prim = bytearray(buf[SECTOR_SIZE:])
        p1_off = 512
        p1_name = bytes(prim[p1_off + 56 : p1_off + 56 + 20])
        changed = False
        if p1_name == "ShieldRed5".encode("utf-16-le"):
            lbl = "ShieldRed 5".encode("utf-16-le")
            prim[p1_off + 56 : p1_off + 56 + 72] = lbl.ljust(72, b"\x00")
            changed = True

        p2_off = 512 + 128
        name_bytes = bytes(prim[p2_off + 56 : p2_off + 64])
        if name_bytes == "VTOY".encode("utf-16-le"):
            cur_attr = struct.unpack_from("<Q", prim, p2_off + 48)[0]
            if cur_attr != SHIELDRED5_EFI_PART_ATTR or changed:
                struct.pack_into("<Q", prim, p2_off + 48, SHIELDRED5_EFI_PART_ATTR)
                back_off = (dev.size // SECTOR_SIZE - 33) * SECTOR_SIZE
                back = bytearray(dev.read_at(back_off, 33 * SECTOR_SIZE))
                if changed:
                    back[56 : 56 + 72] = prim[p1_off + 56 : p1_off + 56 + 72]
                struct.pack_into("<Q", back, 128 + 48, SHIELDRED5_EFI_PART_ATTR)
                back_hdr = back[32 * SECTOR_SIZE :]
                update_gpt_crcs(prim, back_hdr)
                dev.write_at(SECTOR_SIZE, bytes(prim))
                dev.write_at(back_off, bytes(back[: 32 * SECTOR_SIZE]) + bytes(back_hdr))
        elif changed:
            back_off = (dev.size // SECTOR_SIZE - 33) * SECTOR_SIZE
            back = bytearray(dev.read_at(back_off, 33 * SECTOR_SIZE))
            back[56 : 56 + 72] = prim[p1_off + 56 : p1_off + 56 + 72]
            back_hdr = back[32 * SECTOR_SIZE :]
            update_gpt_crcs(prim, back_hdr)
            dev.write_at(SECTOR_SIZE, bytes(prim))
            dev.write_at(back_off, bytes(back[: 32 * SECTOR_SIZE]) + bytes(back_hdr))
    return 0


def cmd_partresize(args) -> int:
    if args.test_gpt:
        with RawBlockDevice(args.disk, write=False) as dev:
            buf = dev.read_at(0, 2 * SECTOR_SIZE)
            return 0 if is_gpt_disk(buf) else 1
    if args.strip_sb is not None:
        with RawBlockDevice(args.disk, write=True) as dev:
            strip_secure_boot_fat16(dev, args.strip_sb)
        return 0
    if args.check:
        with RawBlockDevice(args.disk, write=False) as dev:
            buf = dev.read_at(0, 34 * SECTOR_SIZE)
            if is_gpt_disk(buf):
                last_usable = struct.unpack_from("<Q", buf, 512 + 48)[0]
                p1_start, p1_last = struct.unpack_from("<QQ", buf, 1024 + 32)
                if p1_start != 2048:
                    return 0
                next_lba = last_usable + 1
                for i in range(1, 128):
                    p_off = 1024 + i * 128
                    if buf[p_off + 16 : p_off + 32] != b"\x00" * 16:
                        s_lba = struct.unpack_from("<Q", buf, p_off + 32)[0]
                        if s_lba < next_lba:
                            next_lba = s_lba
                free_bytes = (next_lba - (p1_last + 1)) * SECTOR_SIZE
                return 1 if free_bytes >= SHIELDRED5_EFI_PART_SIZE else 2
            else:
                p1_start, p1_cnt = struct.unpack_from("<II", buf, 446 + 8)
                if p1_start != 2048 or p1_cnt == 0:
                    return 0
                used = sum(1 for i in range(4) if struct.unpack_from("<I", buf, 446 + i * 16 + 12)[0] > 0)
                if used >= 4:
                    return 0
                next_lba = dev.size // SECTOR_SIZE
                for i in range(1, 4):
                    s, c = struct.unpack_from("<II", buf, 446 + i * 16 + 8)
                    if c > 0 and s < next_lba:
                        next_lba = s
                free_bytes = (next_lba - (p1_start + p1_cnt)) * SECTOR_SIZE
                return 1 if free_bytes >= SHIELDRED5_EFI_PART_SIZE else 2
    if args.update_part is not None:
        p2_start = args.update_part
        with RawBlockDevice(args.disk, write=True) as dev:
            buf = bytearray(dev.read_at(0, 34 * SECTOR_SIZE))
            if is_gpt_disk(buf):
                prim = bytearray(buf[SECTOR_SIZE:])
                part_tbl = prim[512:]
                free_idx = next((i for i in range(1, 128) if part_tbl[i * 128 + 16 : i * 128 + 32] == b"\x00" * 16), None)
                if free_idx is None:
                    return 1
                for j in range(free_idx - 1, 0, -1):
                    part_tbl[(j + 1) * 128 : (j + 2) * 128] = part_tbl[j * 128 : (j + 1) * 128]
                struct.pack_into("<Q", part_tbl, 40, p2_start - 1)
                new_p2 = bytearray(128)
                new_p2[0:16] = MS_BASIC_DATA_GUID
                new_p2[16:32] = uuid.uuid4().bytes_le
                struct.pack_into("<QQQ", new_p2, 32, p2_start, p2_start + SHIELDRED5_EFI_PART_SECTORS - 1, SHIELDRED5_EFI_PART_ATTR)
                vtoye = "VTOYEFI".encode("utf-16-le")
                new_p2[56 : 56 + len(vtoye)] = vtoye
                part_tbl[128:256] = new_p2
                prim[512:] = part_tbl
                back_lba = struct.unpack_from("<Q", prim, 32)[0]
                back_off = (back_lba - 32) * SECTOR_SIZE
                back_hdr = bytearray(dev.read_at(back_lba * SECTOR_SIZE, SECTOR_SIZE))
                update_gpt_crcs(prim, back_hdr)
                dev.write_at(SECTOR_SIZE, bytes(prim))
                dev.write_at(back_off, bytes(part_tbl) + bytes(back_hdr))
            else:
                mbr = bytearray(buf[:512])
                free_idx = next((i for i in range(1, 4) if struct.unpack_from("<I", mbr, 446 + i * 16 + 12)[0] == 0), None)
                if free_idx is None:
                    return 1
                for j in range(free_idx - 1, 0, -1):
                    mbr[446 + (j + 1) * 16 : 446 + (j + 2) * 16] = mbr[446 + j * 16 : 446 + (j + 1) * 16]
                mbr[446] = 0x80
                struct.pack_into("<I", mbr, 446 + 12, p2_start - 2048)
                p2 = bytearray(fill_mbr_location(dev.size, p2_start, SHIELDRED5_EFI_PART_SECTORS))
                p2[0] = 0x00
                p2[4] = 0xEF
                mbr[462:478] = p2
                dev.write_at(0, bytes(mbr))
        return 0
    return 1


def cmd_part2_start(args) -> int:
    """Print Partition 2 (EFI/VTOYEFI) start LBA for GPT or MBR disk."""
    with RawBlockDevice(args.disk, write=False) as dev:
        buf = dev.read_at(0, 34 * SECTOR_SIZE)
        if is_gpt_disk(buf):
            tbl_lba = struct.unpack_from("<Q", buf, SECTOR_SIZE + 72)[0]
            tbl_off = tbl_lba * SECTOR_SIZE
            tbl = buf[tbl_off : tbl_off + 128 * 128] if tbl_off + 128 * 128 <= len(buf) else dev.read_at(tbl_off, 128 * 128)
            p2_start = struct.unpack_from("<Q", tbl, 128 + 32)[0]
        else:
            p2_start = struct.unpack_from("<I", buf, 462 + 8)[0]
        if p2_start < 2048:
            return 1
        print(p2_start)
        return 0


def cmd_xzcat(args) -> int:
    with lzma.open(args.src, "rb") as fi:
        out = sys.stdout.buffer
        while True:
            chunk = fi.read(65536)
            if not chunk:
                break
            out.write(chunk)
        out.flush()
    return 0


def cmd_dd_xz(args) -> int:
    """Decompress .xz and write directly to disk at sector offset with alignment."""
    with lzma.open(args.src, "rb") as fi:
        data = fi.read()
    max_bytes = args.sectors * SECTOR_SIZE
    payload = data[:max_bytes]
    with RawBlockDevice(args.disk, write=True) as dev:
        dev.write_at(args.seek_sectors * SECTOR_SIZE, payload)
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: shieldred5_helper.py <fat|gpt|partresize|write-layout|xzcat|dd-xz> ...", file=sys.stderr)
        return 2

    sub = sys.argv[1]
    rest = sys.argv[2:]
    if sub == "fat":
        ap = argparse.ArgumentParser(prog="shieldred5_helper fat")
        ap.add_argument("-T", "--test", action="store_true")
        ap.add_argument("-s", "--secure-boot-check", action="store_true")
        ap.add_argument("--offset", type=int, default=0, help="Sector offset into disk/image")
        ap.add_argument("target", nargs="?")
        return cmd_fat(ap.parse_args(rest))
    if sub == "gpt":
        ap = argparse.ArgumentParser(prog="shieldred5_helper gpt")
        ap.add_argument("-f", "--fix", action="store_true")
        ap.add_argument("disk")
        return cmd_gpt_fix(ap.parse_args(rest))
    if sub == "partresize":
        ap = argparse.ArgumentParser(prog="shieldred5_helper partresize")
        ap.add_argument("-t", "--test-gpt", action="store_true")
        ap.add_argument("-c", "--check", action="store_true")
        ap.add_argument("-s", "--strip-sb", type=int, default=None)
        ap.add_argument("-p", "--update-part", type=int, default=None)
        ap.add_argument("disk")
        if rest and rest[0] in ("-s", "-p") and len(rest) >= 3:
            # Accept vtoycli positional order: partresize -s DISK SECTOR
            disk_arg, sec_arg = rest[1], rest[2]
            args = ap.parse_args([rest[0], sec_arg, disk_arg])
        else:
            args = ap.parse_args(rest)
        return cmd_partresize(args)
    if sub == "write-layout":
        ap = argparse.ArgumentParser(prog="shieldred5_helper write-layout")
        ap.add_argument("--disk", required=True)
        ap.add_argument("--style", choices=("mbr", "gpt"), default="mbr")
        ap.add_argument("--mbr-type", type=lambda x: int(x, 0), default=0x07)
        ap.add_argument("--label", default="ShieldRed 5")
        ap.add_argument("--reserve-mb", type=int, default=0)
        ap.add_argument("--align-4k", action="store_true")
        ap.add_argument("--secure-boot", type=int, default=1)
        ap.add_argument("--boot-img", required=True)
        ap.add_argument("--core-img-xz", required=True)
        ap.add_argument("--disk-img-xz", required=True)
        return cmd_write_layout(ap.parse_args(rest))
    if sub == "part2-start":
        ap = argparse.ArgumentParser(prog="shieldred5_helper part2-start")
        ap.add_argument("disk")
        return cmd_part2_start(ap.parse_args(rest))
    if sub == "xzcat":
        ap = argparse.ArgumentParser(prog="shieldred5_helper xzcat")
        ap.add_argument("src")
        return cmd_xzcat(ap.parse_args(rest))
    if sub == "dd-xz":
        ap = argparse.ArgumentParser(prog="shieldred5_helper dd-xz")
        ap.add_argument("--src", required=True)
        ap.add_argument("--disk", required=True)
        ap.add_argument("--seek-sectors", type=int, required=True)
        ap.add_argument("--sectors", type=int, required=True)
        return cmd_dd_xz(ap.parse_args(rest))

    print(f"Unknown subcommand: {sub}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
