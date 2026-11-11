# Copyright 2026 ShieldRed 5 Maintainers
# Distributed under the terms of the GNU General Public License v3

EAPI=8

DESCRIPTION="Multi-boot USB preparation utility and offline Plugson configurator"
HOMEPAGE="https://www.gnu.org/licenses/gpl-3.0.html"
SRC_URI="${P}.tar.gz"

LICENSE="GPL-3"
SLOT="0"
KEYWORDS="~amd64 ~x86 ~arm64"
IUSE="plugson"

RDEPEND="
	app-shells/bash
	sys-block/parted
	sys-fs/dosfstools
	sys-fs/exfatprogs
	app-arch/xz-utils
	dev-lang/python
	sys-apps/util-linux
	plugson? ( net-libs/nodejs )
"

src_install() {
	bash ./install.sh --prefix /usr --destdir "${ED}" || die
}

