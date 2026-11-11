Name:           shieldred5
Version:        1.1.2
Release:        1%{?dist}
Summary:        Multi-boot USB preparation utility and offline Plugson configurator
License:        GPL-3.0-only
BuildArch:      noarch
Source0:        %{name}-%{version}.tar.gz

Requires:       bash
Requires:       parted
Requires:       dosfstools
Requires:       exfatprogs
Requires:       xz
Requires:       python3
Requires:       util-linux
Recommends:     nodejs >= 18

%description
ShieldRed 5 (Red Ninja Hardened Edition) prepares bootable multi-ISO USB
drives supporting MBR and GPT, BIOS and UEFI (including Secure Boot),
non-destructive upgrades, and an offline Plugson web configurator.

%prep
%setup -q

%build
# Pre-built boot assets and shell/Python/Node CLI wrappers

%install
rm -rf %{buildroot}
bash ./install.sh --prefix %{_prefix} --libdir %{_prefix}/lib/%{name} --docdir %{_docdir}/%{name} --destdir %{buildroot}

%files
%{_bindir}/shieldred5
%{_bindir}/shieldred5-plugson
%{_prefix}/lib/%{name}/
%doc %{_docdir}/%{name}/README.txt

%changelog
* Wed Nov 11 2026 ShieldRed 5 Maintainers - 1.1.2-1
- Initial cross-distro RPM specification for Fedora, RHEL/Rocky/Alma, and openSUSE

