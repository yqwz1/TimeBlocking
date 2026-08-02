# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

root = Path(SPEC).resolve().parent

a = Analysis(
    [str(root / "bridge.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[(str(root / "config"), "config")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="workout-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="workout-engine",
)
