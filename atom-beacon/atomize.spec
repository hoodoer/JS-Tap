# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for building atomize.exe (Windows).

Usage:
    pip install pyinstaller
    pyinstaller atomize.spec

Output: dist/atomize.exe (single file)
"""

a = Analysis(
    ['atomize.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('payload/atom-agent.js', 'payload'),
        ('payload/atom-telemlib.js', 'payload'),
    ],
    hiddenimports=['asar'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='atomize',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=None,
)
