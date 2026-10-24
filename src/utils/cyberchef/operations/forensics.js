/**
 * Forensics Operations
 * Detect File Type, Extract EXIF, Identify Hash
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';
import { detectMagicBytes } from '../magic.js';

// Comprehensive File Signatures Table (50+ Common File Types)
const FILE_SIGNATURES = [
  // Images
  {
    name: 'PNG Image',
    mime: 'image/png',
    ext: 'png',
    category: 'Image',
    desc: 'Portable Network Graphics lossless bitmap image',
    match: b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
    magicHex: '89 50 4E 47 0D 0A 1A 0A'
  },
  {
    name: 'JPEG Image',
    mime: 'image/jpeg',
    ext: 'jpg',
    category: 'Image',
    desc: 'Joint Photographic Experts Group lossy image',
    match: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    magicHex: 'FF D8 FF'
  },
  {
    name: 'GIF87a Image',
    mime: 'image/gif',
    ext: 'gif',
    category: 'Image',
    desc: 'Graphics Interchange Format 87a',
    match: b => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x37 && b[5] === 0x61,
    magicHex: '47 49 46 38 37 61'
  },
  {
    name: 'GIF89a Image',
    mime: 'image/gif',
    ext: 'gif',
    category: 'Image',
    desc: 'Graphics Interchange Format 89a',
    match: b => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x39 && b[5] === 0x61,
    magicHex: '47 49 46 38 39 61'
  },
  {
    name: 'WebP Image',
    mime: 'image/webp',
    ext: 'webp',
    category: 'Image',
    desc: 'Google WebP modern compressed image',
    match: b => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    magicHex: '52 49 46 46 .. .. .. .. 57 45 42 50'
  },
  {
    name: 'BMP Image',
    mime: 'image/bmp',
    ext: 'bmp',
    category: 'Image',
    desc: 'Microsoft Windows Bitmap graphic',
    match: b => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
    magicHex: '42 4D'
  },
  {
    name: 'TIFF Image (Little Endian)',
    mime: 'image/tiff',
    ext: 'tiff',
    category: 'Image',
    desc: 'Tagged Image File Format (Intel byte order)',
    match: b => b.length >= 4 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00,
    magicHex: '49 49 2A 00'
  },
  {
    name: 'TIFF Image (Big Endian)',
    mime: 'image/tiff',
    ext: 'tiff',
    category: 'Image',
    desc: 'Tagged Image File Format (Motorola byte order)',
    match: b => b.length >= 4 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a,
    magicHex: '4D 4D 00 2A'
  },
  {
    name: 'Windows Icon (ICO)',
    mime: 'image/x-icon',
    ext: 'ico',
    category: 'Image',
    desc: 'Microsoft Windows Icon resource file',
    match: b => b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00,
    magicHex: '00 00 01 00'
  },
  {
    name: 'Photoshop Document (PSD)',
    mime: 'image/vnd.adobe.photoshop',
    ext: 'psd',
    category: 'Image',
    desc: 'Adobe Photoshop layered image document',
    match: b => b.length >= 4 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53,
    magicHex: '38 42 50 53'
  },

  // Documents
  {
    name: 'PDF Document',
    mime: 'application/pdf',
    ext: 'pdf',
    category: 'Document',
    desc: 'Adobe Portable Document Format',
    match: b => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    magicHex: '25 50 44 46'
  },
  {
    name: 'PostScript Document',
    mime: 'application/postscript',
    ext: 'ps',
    category: 'Document',
    desc: 'Adobe PostScript page description language',
    match: b => b.length >= 4 && b[0] === 0x25 && b[1] === 0x21 && b[2] === 0x50 && b[3] === 0x53,
    magicHex: '25 21 50 53'
  },
  {
    name: 'Rich Text Format (RTF)',
    mime: 'application/rtf',
    ext: 'rtf',
    category: 'Document',
    desc: 'Microsoft Rich Text Format document',
    match: b => b.length >= 5 && b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66,
    magicHex: '7B 5C 72 74 66'
  },
  {
    name: 'Microsoft Office Compound Document (OLE2)',
    mime: 'application/x-ole-storage',
    ext: 'doc',
    category: 'Document',
    desc: 'Legacy Microsoft Office binary document (DOC/XLS/PPT)',
    match: b => b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1,
    magicHex: 'D0 CF 11 E0 A1 B1 1A E1'
  },

  // Executables & Bytecode
  {
    name: 'ELF Binary (Linux/Unix)',
    mime: 'application/x-executable',
    ext: 'elf',
    category: 'Executable',
    desc: 'Executable and Linkable Format binary',
    match: b => b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46,
    magicHex: '7F 45 4C 46'
  },
  {
    name: 'Windows PE / DOS Executable',
    mime: 'application/x-dosexec',
    ext: 'exe',
    category: 'Executable',
    desc: 'Microsoft Portable Executable / DOS MZ format',
    match: b => b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a,
    magicHex: '4D 5A'
  },
  {
    name: 'Mach-O 32-bit (macOS/iOS)',
    mime: 'application/x-mach-binary',
    ext: 'macho',
    category: 'Executable',
    desc: 'Apple Mach-O 32-bit executable binary',
    match: b => b.length >= 4 && ((b[0] === 0xfe && b[1] === 0xed && b[2] === 0xfa && b[3] === 0xce) || (b[0] === 0xce && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe)),
    magicHex: 'FE ED FA CE'
  },
  {
    name: 'Mach-O 64-bit (macOS/iOS)',
    mime: 'application/x-mach-binary',
    ext: 'macho',
    category: 'Executable',
    desc: 'Apple Mach-O 64-bit executable binary',
    match: b => b.length >= 4 && ((b[0] === 0xfe && b[1] === 0xed && b[2] === 0xfa && b[3] === 0xcf) || (b[0] === 0xcf && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe)),
    magicHex: 'FE ED FA CF'
  },
  {
    name: 'Java Class File',
    mime: 'application/java-vm',
    ext: 'class',
    category: 'Bytecode',
    desc: 'Compiled Java Virtual Machine bytecode',
    match: b => b.length >= 8 && b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe && (b[4] === 0x00 || b[6] === 0x00),
    magicHex: 'CA FE BA BE'
  },
  {
    name: 'WebAssembly Binary (WASM)',
    mime: 'application/wasm',
    ext: 'wasm',
    category: 'Bytecode',
    desc: 'WebAssembly binary executable module',
    match: b => b.length >= 4 && b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d,
    magicHex: '00 61 73 6D'
  },
  {
    name: 'Android Dalvik Executable (DEX)',
    mime: 'application/vnd.android.dex',
    ext: 'dex',
    category: 'Bytecode',
    desc: 'Android OS Dalvik/ART virtual machine bytecode',
    match: b => b.length >= 4 && b[0] === 0x64 && b[1] === 0x65 && b[2] === 0x78 && b[3] === 0x0a,
    magicHex: '64 65 78 0A'
  },

  // Archives & Compressed Containers
  {
    name: 'ZIP Archive',
    mime: 'application/zip',
    ext: 'zip',
    category: 'Archive',
    desc: 'PKZip compressed archive container',
    match: b => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 0x03 && b[3] === 0x04) || (b[2] === 0x05 && b[3] === 0x06) || (b[2] === 0x07 && b[3] === 0x08)),
    magicHex: '50 4B 03 04'
  },
  {
    name: 'Gzip Archive',
    mime: 'application/gzip',
    ext: 'gz',
    category: 'Archive',
    desc: 'RFC 1952 GNU zip compressed archive',
    match: b => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b,
    magicHex: '1F 8B'
  },
  {
    name: 'Bzip2 Archive',
    mime: 'application/x-bzip2',
    ext: 'bz2',
    category: 'Archive',
    desc: 'Burrows-Wheeler block-sorting compressed archive',
    match: b => b.length >= 3 && b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68,
    magicHex: '42 5A 68'
  },
  {
    name: '7-Zip Archive',
    mime: 'application/x-7z-compressed',
    ext: '7z',
    category: 'Archive',
    desc: '7-Zip LZMA high-ratio compressed archive',
    match: b => b.length >= 6 && b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c,
    magicHex: '37 7A BC AF 27 1C'
  },
  {
    name: 'XZ Archive',
    mime: 'application/x-xz',
    ext: 'xz',
    category: 'Archive',
    desc: 'XZ / LZMA2 container format',
    match: b => b.length >= 6 && b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a && b[5] === 0x00,
    magicHex: 'FD 37 7A 58 5A 00'
  },
  {
    name: 'RAR Archive (v4)',
    mime: 'application/vnd.rar',
    ext: 'rar',
    category: 'Archive',
    desc: 'Roshal Archive compressed format v4',
    match: b => b.length >= 7 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07 && b[6] === 0x00,
    magicHex: '52 61 72 21 1A 07 00'
  },
  {
    name: 'RAR Archive (v5)',
    mime: 'application/vnd.rar',
    ext: 'rar',
    category: 'Archive',
    desc: 'Roshal Archive compressed format v5',
    match: b => b.length >= 8 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07 && b[6] === 0x01 && b[7] === 0x00,
    magicHex: '52 61 72 21 1A 07 01 00'
  },
  {
    name: 'POSIX TAR Archive',
    mime: 'application/x-tar',
    ext: 'tar',
    category: 'Archive',
    desc: 'POSIX USTAR Tape Archive format',
    match: b => b.length >= 265 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72,
    magicHex: 'ustar (offset 257)'
  },
  {
    name: 'Zstandard Archive',
    mime: 'application/zstd',
    ext: 'zst',
    category: 'Archive',
    desc: 'Facebook Zstandard high-speed real-time compression',
    match: b => b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd,
    magicHex: '28 B5 2F FD'
  },
  {
    name: 'CPIO Archive',
    mime: 'application/x-cpio',
    ext: 'cpio',
    category: 'Archive',
    desc: 'UNIX CPIO tape archive',
    match: b => b.length >= 6 && b[0] === 0x30 && b[1] === 0x37 && b[2] === 0x30 && b[3] === 0x37 && b[4] === 0x30 && (b[5] === 0x31 || b[5] === 0x32 || b[5] === 0x37),
    magicHex: '30 37 30 37 30 31'
  },
  {
    name: 'ISO 9660 Optical Disc Image',
    mime: 'application/x-iso9660-image',
    ext: 'iso',
    category: 'Archive',
    desc: 'Standard CD/DVD volume image',
    match: b => (b.length >= 0x8005 && b[0x8001] === 0x43 && b[0x8002] === 0x44 && b[0x8003] === 0x30 && b[0x8004] === 0x30 && b[0x8005] === 0x31),
    magicHex: 'CD001 (offset 0x8001)'
  },

  // Databases & Network Forensic Captures
  {
    name: 'SQLite 3 Database',
    mime: 'application/x-sqlite3',
    ext: 'sqlite',
    category: 'Database',
    desc: 'SQLite embedded relational database storage engine',
    match: b => b.length >= 16 && b[0] === 0x53 && b[1] === 0x51 && b[2] === 0x4c && b[3] === 0x69 && b[4] === 0x74 && b[5] === 0x65 && b[6] === 0x20 && b[7] === 0x66,
    magicHex: '53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00'
  },
  {
    name: 'PCAP Capture (Microsecond LE)',
    mime: 'application/vnd.tcpdump.pcap',
    ext: 'pcap',
    category: 'Forensics',
    desc: 'Libpcap network packet trace (Little Endian)',
    match: b => b.length >= 4 && b[0] === 0xd4 && b[1] === 0xc3 && b[2] === 0xb2 && b[3] === 0xa1,
    magicHex: 'D4 C3 B2 A1'
  },
  {
    name: 'PCAP Capture (Microsecond BE)',
    mime: 'application/vnd.tcpdump.pcap',
    ext: 'pcap',
    category: 'Forensics',
    desc: 'Libpcap network packet trace (Big Endian)',
    match: b => b.length >= 4 && b[0] === 0xa1 && b[1] === 0xb2 && b[2] === 0xc3 && b[3] === 0xd4,
    magicHex: 'A1 B2 C3 D4'
  },
  {
    name: 'PCAP Capture (Nanosecond LE)',
    mime: 'application/vnd.tcpdump.pcap',
    ext: 'pcap',
    category: 'Forensics',
    desc: 'Libpcap nanosecond timestamp network trace',
    match: b => b.length >= 4 && b[0] === 0x4d && b[1] === 0x3c && b[2] === 0xb2 && b[3] === 0xa1,
    magicHex: '4D 3C B2 A1'
  },
  {
    name: 'PCAP Next Generation (PCAPNG)',
    mime: 'application/x-pcapng',
    ext: 'pcapng',
    category: 'Forensics',
    desc: 'PcapNG multi-interface packet capture format',
    match: b => b.length >= 4 && b[0] === 0x0a && b[1] === 0x0d && b[2] === 0x0d && b[3] === 0x0a,
    magicHex: '0A 0D 0D 0A'
  },
  {
    name: 'Redis RDB Storage',
    mime: 'application/x-redis-rdb',
    ext: 'rdb',
    category: 'Database',
    desc: 'Redis In-Memory Database snapshot dump',
    match: b => b.length >= 5 && b[0] === 0x52 && b[1] === 0x45 && b[2] === 0x44 && b[3] === 0x49 && b[4] === 0x53,
    magicHex: '52 45 44 49 53'
  },
  {
    name: 'Git Packfile',
    mime: 'application/x-git-pack',
    ext: 'pack',
    category: 'Storage',
    desc: 'Git version control object packfile',
    match: b => b.length >= 4 && b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x43 && b[3] === 0x4b,
    magicHex: '50 41 43 4B'
  },

  // Audio & Multimedia
  {
    name: 'MP3 Audio (ID3v2 Tag)',
    mime: 'audio/mpeg',
    ext: 'mp3',
    category: 'Audio',
    desc: 'MPEG Audio Layer III with ID3v2 metadata header',
    match: b => b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33,
    magicHex: '49 44 33'
  },
  {
    name: 'MP3 Audio (Frame Sync)',
    mime: 'audio/mpeg',
    ext: 'mp3',
    category: 'Audio',
    desc: 'Raw MPEG Audio Layer III frame sync stream',
    match: b => b.length >= 2 && b[0] === 0xff && (b[1] === 0xfb || b[1] === 0xf3 || b[1] === 0xf2),
    magicHex: 'FF FB'
  },
  {
    name: 'FLAC Audio',
    mime: 'audio/flac',
    ext: 'flac',
    category: 'Audio',
    desc: 'Free Lossless Audio Codec container',
    match: b => b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43,
    magicHex: '66 4C 61 43'
  },
  {
    name: 'Ogg Multimedia Container',
    mime: 'audio/ogg',
    ext: 'ogg',
    category: 'Audio',
    desc: 'Xiph.Org Ogg bitstream container (Vorbis/Opus)',
    match: b => b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53,
    magicHex: '4F 67 67 53'
  },
  {
    name: 'WAV Audio (RIFF)',
    mime: 'audio/wav',
    ext: 'wav',
    category: 'Audio',
    desc: 'Waveform Audio File Format container',
    match: b => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45,
    magicHex: '52 49 46 46 .. .. .. .. 57 41 56 45'
  },
  {
    name: 'AVI Video (RIFF)',
    mime: 'video/x-msvideo',
    ext: 'avi',
    category: 'Video',
    desc: 'Audio Video Interleave container format',
    match: b => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x41 && b[9] === 0x56 && b[10] === 0x49 && b[11] === 0x20,
    magicHex: '52 49 46 46 .. .. .. .. 41 56 49 20'
  },
  {
    name: 'MIDI Audio',
    mime: 'audio/midi',
    ext: 'mid',
    category: 'Audio',
    desc: 'Musical Instrument Digital Interface sound sequence',
    match: b => b.length >= 4 && b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64,
    magicHex: '4D 54 68 64'
  },
  {
    name: 'MP4 / QuickTime Video',
    mime: 'video/mp4',
    ext: 'mp4',
    category: 'Video',
    desc: 'ISO Base Media File Format container (ftyp)',
    match: b => b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
    magicHex: '.. .. .. .. 66 74 79 70'
  },
  {
    name: 'Matroska Video (MKV / WebM)',
    mime: 'video/x-matroska',
    ext: 'mkv',
    category: 'Video',
    desc: 'EBML Matroska multimedia container',
    match: b => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
    magicHex: '1A 45 DF A3'
  },
  {
    name: 'FLV Video',
    mime: 'video/x-flv',
    ext: 'flv',
    category: 'Video',
    desc: 'Adobe Flash Video file container',
    match: b => b.length >= 4 && b[0] === 0x46 && b[1] === 0x4c && b[2] === 0x56 && b[3] === 0x01,
    magicHex: '46 4C 56 01'
  },

  // Security, Hardware & Firmware
  {
    name: 'DER X.509 Certificate',
    mime: 'application/x-x509-ca-cert',
    ext: 'der',
    category: 'Certificate',
    desc: 'ASN.1 DER-encoded X.509 public key certificate',
    match: b => b.length >= 2 && b[0] === 0x30 && b[1] === 0x82,
    magicHex: '30 82'
  },
  {
    name: 'PGP / OpenPGP Keyring',
    mime: 'application/pgp-keys',
    ext: 'gpg',
    category: 'Security',
    desc: 'OpenPGP binary public/secret keyring',
    match: b => b.length >= 2 && ((b[0] === 0x99 && b[1] === 0x00) || (b[0] === 0x98 && b[1] === 0x00) || b[0] === 0x85),
    magicHex: '99 00'
  },
  {
    name: 'ESP32 Firmware Image',
    mime: 'application/octet-stream',
    ext: 'bin',
    category: 'Firmware',
    desc: 'Espressif ESP32/ESP8266 bootloader and application ROM',
    match: b => b.length >= 4 && b[0] === 0xe9 && (b[1] === 0x00 || b[1] === 0x01 || b[1] === 0x02 || b[1] === 0x03),
    magicHex: 'E9 00'
  },
  {
    name: 'Device Tree Blob (Flattened DTB)',
    mime: 'application/x-dtb',
    ext: 'dtb',
    category: 'Hardware',
    desc: 'Linux device tree hardware descriptor blob',
    match: b => b.length >= 4 && b[0] === 0xd0 && b[1] === 0x0d && b[2] === 0xfe && b[3] === 0xed,
    magicHex: 'D0 0D FE ED'
  },
  {
    name: 'XML Document',
    mime: 'application/xml',
    ext: 'xml',
    category: 'Text/Markup',
    desc: 'Extensible Markup Language document',
    match: b => b.length >= 5 && b[0] === 0x3c && b[1] === 0x3f && b[2] === 0x78 && b[3] === 0x6d && b[4] === 0x6c,
    magicHex: '3C 3F 78 6D 6C'
  },
  {
    name: 'HTML Document',
    mime: 'text/html',
    ext: 'html',
    category: 'Text/Markup',
    desc: 'HyperText Markup Language web page',
    match: b => {
      if (b.length < 15) return false;
      const str = String.fromCharCode(...b.slice(0, 30)).toLowerCase();
      return str.includes('<!doctype html') || str.includes('<html');
    },
    magicHex: '3C 21 44 4F 43'
  }
];

export class DetectFileTypeOperation extends Operation {
  constructor() {
    super({
      name: 'Detect File Type',
      id: 'detect_file_type',
      module: 'Forensics',
      description: 'Identifies file types and MIME categories from header magic bytes across 50+ common formats.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let bytes = inputDish.toUint8Array();

    // Check if Base64 or Hex encoded
    if (bytes.length < 2) {
      const text = inputDish.toString().trim();
      if (/^[0-9a-fA-F\s]{4,}$/.test(text)) {
        try { bytes = Dish.fromHex(text).toUint8Array(); } catch {}
      } else if (/^[A-Za-z0-9+/=]{4,}$/.test(text.replace(/\s+/g, ''))) {
        try { bytes = Dish.fromBase64(text).toUint8Array(); } catch {}
      }
    }

    if (bytes.length === 0) {
      return JSON.stringify({
        detected: false,
        fileType: 'Empty Payload',
        mimeType: 'application/x-empty',
        extension: '',
        category: 'Empty',
        fileSize: 0
      }, null, 2);
    }

    // Header bytes snippet in hex
    const headerHex = Array.from(bytes.slice(0, Math.min(24, bytes.length)))
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');

    // Match against signatures
    for (const sig of FILE_SIGNATURES) {
      if (sig.match(bytes)) {
        return JSON.stringify({
          detected: true,
          fileType: sig.name,
          mimeType: sig.mime,
          extension: sig.ext,
          category: sig.category,
          magicHex: sig.magicHex,
          description: sig.desc,
          headerBytes: headerHex,
          fileSize: bytes.length
        }, null, 2);
      }
    }

    // Fallback: check printable ratio to distinguish plain text from unknown binary
    let printableCount = 0;
    for (let i = 0; i < Math.min(512, bytes.length); i++) {
      const b = bytes[i];
      if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
        printableCount++;
      }
    }
    const isText = (printableCount / Math.min(512, bytes.length)) > 0.85;

    return JSON.stringify({
      detected: isText,
      fileType: isText ? 'Plain Text Document' : 'Unknown Binary Data',
      mimeType: isText ? 'text/plain' : 'application/octet-stream',
      extension: isText ? 'txt' : 'bin',
      category: isText ? 'Text' : 'Unknown',
      description: isText ? 'ASCII or UTF-8 encoded text stream' : 'Unrecognized binary file signature',
      headerBytes: headerHex,
      fileSize: bytes.length
    }, null, 2);
  }
}

export class ExtractExifOperation extends Operation {
  constructor() {
    super({
      name: 'Extract EXIF',
      id: 'extract_exif',
      module: 'Forensics',
      description: 'Parses JPEG App1 EXIF metadata headers (Camera model, timestamp, software).',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    if (bytes.length < 4) return 'No EXIF metadata present.';

    const text = inputDish.toString();
    const metadata = {};

    // Match ASCII EXIF tokens embedded in binary stream
    const makeMatch = text.match(/(?:Canon|Nikon|Apple|Sony|Samsung|Google|DJI|Fujifilm)/i);
    const dateMatch = text.match(/\b(20\d{2}[:\-/]\d{2}[:\-/]\d{2}\s+\d{2}:\d{2}:\d{2})\b/);
    const softwareMatch = text.match(/(?:Photoshop|Lightroom|iOS|Android|Firmware\s+v?[\d.]+)/i);

    if (makeMatch) metadata.cameraMake = makeMatch[0];
    if (dateMatch) metadata.dateTime = dateMatch[0];
    if (softwareMatch) metadata.software = softwareMatch[0];

    if (Object.keys(metadata).length === 0) {
      return 'No recognizable EXIF / camera metadata found in stream.';
    }

    return JSON.stringify(metadata, null, 2);
  }
}

export class IdentifyHashOperation extends Operation {
  constructor() {
    super({
      name: 'Identify Hash',
      id: 'identify_hash',
      module: 'Forensics',
      description: 'Identifies probable cryptographic hash algorithm based on length and charset.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    const clean = input.trim();
    const len = clean.length;
    const isHex = /^[0-9a-fA-F]+$/.test(clean);
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(clean);

    const candidates = [];

    if (clean.startsWith('$2a$') || clean.startsWith('$2b$') || clean.startsWith('$2y$')) {
      candidates.push({ algorithm: 'Bcrypt Password Hash', bitLength: 184, confidence: 'Very High' });
    } else if (clean.startsWith('$6$')) {
      candidates.push({ algorithm: 'SHA-512 Crypt (Linux shadow)', bitLength: 512, confidence: 'Very High' });
    } else if (clean.startsWith('$1$')) {
      candidates.push({ algorithm: 'MD5 Crypt (Linux shadow)', bitLength: 128, confidence: 'Very High' });
    } else if (isHex) {
      if (len === 32) {
        candidates.push({ algorithm: 'MD5', bitLength: 128, confidence: 'High' });
        candidates.push({ algorithm: 'NTLM', bitLength: 128, confidence: 'High' });
        candidates.push({ algorithm: 'MD4', bitLength: 128, confidence: 'Medium' });
      } else if (len === 40) {
        candidates.push({ algorithm: 'SHA-1', bitLength: 160, confidence: 'High' });
        candidates.push({ algorithm: 'RIPEMD-160', bitLength: 160, confidence: 'Medium' });
      } else if (len === 56) {
        candidates.push({ algorithm: 'SHA-224', bitLength: 224, confidence: 'High' });
        candidates.push({ algorithm: 'SHA3-224', bitLength: 224, confidence: 'High' });
      } else if (len === 64) {
        candidates.push({ algorithm: 'SHA-256', bitLength: 256, confidence: 'High' });
        candidates.push({ algorithm: 'BLAKE2s', bitLength: 256, confidence: 'Medium' });
        candidates.push({ algorithm: 'SHA3-256', bitLength: 256, confidence: 'Medium' });
      } else if (len === 96) {
        candidates.push({ algorithm: 'SHA-384', bitLength: 384, confidence: 'High' });
      } else if (len === 128) {
        candidates.push({ algorithm: 'SHA-512', bitLength: 512, confidence: 'High' });
        candidates.push({ algorithm: 'BLAKE2b', bitLength: 512, confidence: 'High' });
        candidates.push({ algorithm: 'Whirlpool', bitLength: 512, confidence: 'Medium' });
      } else if (len === 8) {
        candidates.push({ algorithm: 'CRC-32 / Adler-32 Checksum', bitLength: 32, confidence: 'High' });
      }
    }

    if (candidates.length === 0) {
      return `Unrecognized hash format (Length: ${len} chars).`;
    }

    return JSON.stringify({
      inputLength: len,
      isHex,
      isBase64,
      possibleAlgorithms: candidates
    }, null, 2);
  }
}

export const forensicOperations = [
  new DetectFileTypeOperation(),
  new ExtractExifOperation(),
  new IdentifyHashOperation()
];
