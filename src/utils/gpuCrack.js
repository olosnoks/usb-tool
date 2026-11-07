// WebGPU MD5 mask/brute-force accelerator for the Hash Cracker.
//
// A browser can reach the GPU through WebGPU (navigator.gpu) compute shaders.
// MD5 brute-force parallelizes extremely well, so this runs a WGSL compute
// kernel that, for each candidate ordinal in a mask keyspace, builds the
// candidate string, computes MD5, and compares against the target digest(s),
// writing any matches back.
//
// Because WebGPU can't be exercised in CI, the engine SELF-TESTS on the user's
// real hardware (cracks a known plaintext) before it is trusted; if the
// self-test fails or WebGPU is unavailable, the UI falls back to the CPU engine.
//
// Scope: MD5 only, single-block candidates (length ≤ 55), keyspace ≤ 2^32.

export function gpuAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Decode a candidate ordinal into per-position charset indices (last fastest). */
export function ordinalToIndices(ordinal, sizes) {
  const idx = new Array(sizes.length);
  let o = ordinal;
  for (let i = sizes.length - 1; i >= 0; i--) { idx[i] = o % sizes[i]; o = Math.floor(o / sizes[i]); }
  return idx;
}

/** Rebuild the candidate string for an ordinal given parsed mask charsets. */
export function ordinalToString(ordinal, sets) {
  const sizes = sets.map((s) => s.length);
  const idx = ordinalToIndices(ordinal, sizes);
  let s = '';
  for (let i = 0; i < sets.length; i++) s += sets[i][idx[i]];
  return s;
}

/** Pack an MD5 hex digest into 4 little-endian u32 words (matching MD5 state). */
export function packMd5Target(hex) {
  const h = String(hex).trim().toLowerCase();
  const words = [];
  for (let w = 0; w < 4; w++) {
    let v = 0;
    for (let b = 0; b < 4; b++) {
      const byte = parseInt(h.substr((w * 4 + b) * 2, 2), 16) || 0;
      v |= byte << (b * 8);
    }
    words.push(v >>> 0);
  }
  return words;
}

const WGSL = /* wgsl */`
struct Params {
  maskLen: u32,
  numTargets: u32,
  batchOffset: u32,
  dispatchCount: u32,
  maxResults: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> charset: array<u32>; // one byte per element
@group(0) @binding(2) var<storage, read> offsets: array<u32>; // per position
@group(0) @binding(3) var<storage, read> sizes: array<u32>;   // per position
@group(0) @binding(4) var<storage, read> targets: array<u32>; // 4 words per target
@group(0) @binding(5) var<storage, read_write> outCount: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> outData: array<u32>; // pairs: ordinal,targetIdx

const K = array<u32,64>(
  0xd76aa478u,0xe8c7b756u,0x242070dbu,0xc1bdceeeu,0xf57c0fafu,0x4787c62au,0xa8304613u,0xfd469501u,
  0x698098d8u,0x8b44f7afu,0xffff5bb1u,0x895cd7beu,0x6b901122u,0xfd987193u,0xa679438eu,0x49b40821u,
  0xf61e2562u,0xc040b340u,0x265e5a51u,0xe9b6c7aau,0xd62f105du,0x02441453u,0xd8a1e681u,0xe7d3fbc8u,
  0x21e1cde6u,0xc33707d6u,0xf4d50d87u,0x455a14edu,0xa9e3e905u,0xfcefa3f8u,0x676f02d9u,0x8d2a4c8au,
  0xfffa3942u,0x8771f681u,0x6d9d6122u,0xfde5380cu,0xa4beea44u,0x4bdecfa9u,0xf6bb4b60u,0xbebfbc70u,
  0x289b7ec6u,0xeaa127fau,0xd4ef3085u,0x04881d05u,0xd9d4d039u,0xe6db99e5u,0x1fa27cf8u,0xc4ac5665u,
  0xf4292244u,0x432aff97u,0xab9423a7u,0xfc93a039u,0x655b59c3u,0x8f0ccc92u,0xffeff47du,0x85845dd1u,
  0x6fa87e4fu,0xfe2ce6e0u,0xa3014314u,0x4e0811a1u,0xf7537e82u,0xbd3af235u,0x2ad7d2bbu,0xeb86d391u
);
const S = array<u32,64>(
  7u,12u,17u,22u,7u,12u,17u,22u,7u,12u,17u,22u,7u,12u,17u,22u,
  5u,9u,14u,20u,5u,9u,14u,20u,5u,9u,14u,20u,5u,9u,14u,20u,
  4u,11u,16u,23u,4u,11u,16u,23u,4u,11u,16u,23u,4u,11u,16u,23u,
  6u,10u,15u,21u,6u,10u,15u,21u,6u,10u,15u,21u,6u,10u,15u,21u
);

fn rotl(x: u32, c: u32) -> u32 { return (x << c) | (x >> (32u - c)); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.dispatchCount) { return; }
  let ordinal = P.batchOffset + gid.x;

  // decode ordinal -> message bytes via mask (last position fastest)
  var m = array<u32,16>();
  var bytes = array<u32,55>();
  var rem = ordinal;
  for (var p = P.maskLen; p > 0u; p = p - 1u) {
    let pos = p - 1u;
    let sz = sizes[pos];
    let ci = rem % sz;
    rem = rem / sz;
    bytes[pos] = charset[offsets[pos] + ci];
  }
  // pack message words (little-endian), append 0x80, set bit length
  for (var i = 0u; i < P.maskLen; i++) {
    let wi = i / 4u;
    let sh = (i % 4u) * 8u;
    m[wi] = m[wi] | (bytes[i] << sh);
  }
  let padIdx = P.maskLen;
  m[padIdx / 4u] = m[padIdx / 4u] | (0x80u << ((padIdx % 4u) * 8u));
  m[14] = P.maskLen * 8u;

  var a: u32 = 0x67452301u;
  var b: u32 = 0xefcdab89u;
  var c: u32 = 0x98badcfeu;
  var d: u32 = 0x10325476u;
  for (var i = 0u; i < 64u; i++) {
    var f: u32;
    var g: u32;
    if (i < 16u) { f = (b & c) | (~b & d); g = i; }
    else if (i < 32u) { f = (d & b) | (~d & c); g = (5u * i + 1u) % 16u; }
    else if (i < 48u) { f = b ^ c ^ d; g = (3u * i + 5u) % 16u; }
    else { f = c ^ (b | ~d); g = (7u * i) % 16u; }
    let tmpv = d;
    d = c; c = b;
    b = b + rotl(a + f + K[i] + m[g], S[i]);
    a = tmpv;
  }
  a = a + 0x67452301u; b = b + 0xefcdab89u; c = c + 0x98badcfeu; d = d + 0x10325476u;

  for (var t = 0u; t < P.numTargets; t++) {
    let base = t * 4u;
    if (a == targets[base] && b == targets[base+1u] && c == targets[base+2u] && d == targets[base+3u]) {
      let slot = atomicAdd(&outCount, 1u);
      if (slot < P.maxResults) { outData[slot * 2u] = ordinal; outData[slot * 2u + 1u] = t; }
    }
  }
}
`;

const MAX_RESULTS = 1024;

export class GpuMd5Cracker {
  constructor() { this.device = null; this.pipeline = null; }

  async init() {
    if (!gpuAvailable()) throw new Error('WebGPU not available in this browser');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    this.device = await adapter.requestDevice();
    const module = this.device.createShaderModule({ code: WGSL });
    this.pipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.adapterInfo = adapter.info || {};
  }

  /** Verify correctness on real hardware: crack a known MD5 over a small mask. */
  async selfTest() {
    // md5("abcz") against mask ?l?l?l?l — ordinal of "abcz" must be found.
    const sets = ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz'];
    const target = 'db3c0a4694ffb9406c838b249a044f69'; // md5("abcz")
    const res = await this.crackMask(sets, [target], { batchSize: sets[0].length ** 4 });
    return res.length === 1 && res[0].password === 'abcz';
  }

  /**
   * Crack a parsed mask (array of charset strings) against target MD5 hex digests.
   * Returns [{ targetIndex, hashIndexInInput? , password }]. Calls onProgress(done,total).
   */
  async crackMask(sets, targetHexes, { batchSize = 1 << 20, onProgress, onFound, shouldStop } = {}) {
    const dev = this.device;
    const sizes = sets.map((s) => s.length);
    const keyspace = sizes.reduce((a, b) => a * b, 1);
    if (keyspace > 0xffffffff) throw new Error('Keyspace exceeds 2^32 — too large for the GPU path');
    if (sets.length > 55) throw new Error('Mask too long for single-block MD5 (≤55)');

    // flatten charsets
    const flat = []; const offsets = []; let off = 0;
    for (const s of sets) { offsets.push(off); for (const ch of s) flat.push(ch.charCodeAt(0)); off += s.length; }
    const targets = [];
    for (const hx of targetHexes) targets.push(...packMd5Target(hx));

    const u32 = (arr) => { const b = dev.createBuffer({ size: Math.max(4, arr.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Uint32Array(arr.length ? arr : [0])); return b; };
    const charsetBuf = u32(flat);
    const offBuf = u32(offsets);
    const sizeBuf = u32(sizes);
    const targetBuf = u32(targets);
    const outCount = dev.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const outData = dev.createBuffer({ size: MAX_RESULTS * 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const paramBuf = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readCount = dev.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const readData = dev.createBuffer({ size: MAX_RESULTS * 2 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const bind = dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: { buffer: charsetBuf } },
        { binding: 2, resource: { buffer: offBuf } },
        { binding: 3, resource: { buffer: sizeBuf } },
        { binding: 4, resource: { buffer: targetBuf } },
        { binding: 5, resource: { buffer: outCount } },
        { binding: 6, resource: { buffer: outData } },
      ],
    });

    const found = [];
    for (let offset = 0; offset < keyspace; offset += batchSize) {
      if (shouldStop?.()) break;
      const count = Math.min(batchSize, keyspace - offset);
      dev.queue.writeBuffer(paramBuf, 0, new Uint32Array([sets.length, targetHexes.length, offset, count, MAX_RESULTS, 0, 0, 0]));
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(count / 64));
      pass.end();
      enc.copyBufferToBuffer(outCount, 0, readCount, 0, 4);
      enc.copyBufferToBuffer(outData, 0, readData, 0, MAX_RESULTS * 2 * 4);
      dev.queue.submit([enc.finish()]);
      await readCount.mapAsync(GPUMapMode.READ);
      const n = new Uint32Array(readCount.getMappedRange())[0];
      readCount.unmap();
      if (n > 0) {
        await readData.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(readData.getMappedRange().slice(0));
        readData.unmap();
        for (let i = 0; i < Math.min(n, MAX_RESULTS); i++) {
          const ordinal = data[i * 2]; const tIdx = data[i * 2 + 1];
          const hit = { targetIndex: tIdx, hex: targetHexes[tIdx], password: ordinalToString(ordinal, sets) };
          found.push(hit); onFound?.(hit);
        }
      }
      onProgress?.(Math.min(offset + count, keyspace), keyspace);
      if (found.length >= targetHexes.length) break;
    }
    // de-dup by targetIndex
    const seen = new Set();
    return found.filter((f) => (seen.has(f.targetIndex) ? false : (seen.add(f.targetIndex), true)));
  }
}
