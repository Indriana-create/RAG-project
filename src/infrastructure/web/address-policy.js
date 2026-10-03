import { BlockList, isIP } from 'node:net';

/**
 * Kebijakan alamat untuk pengambilan halaman web: HANYA alamat internet publik yang boleh dituju. Tanpa ini,
 * fitur "ambil dari URL" bisa dipakai untuk menjangkau layanan internal server (LLM, database, n8n, metadata cloud).
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]]) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Alamat IPv4 yang tertanam di IPv6 (::ffff:a.b.c.d, 64:ff9b::a.b.c.d) harus diperiksa sebagai IPv4-nya. */
function embeddedIPv4(ip) {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isPublicAddress(ip) {
  const family = isIP(ip);
  if (!family) return false;
  if (family === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return isPublicAddress(v4);
    if (/^2002:/i.test(ip)) return false; // 6to4: alamat IPv4 tertanam, jangan dipercaya
    return !blocked.check(ip, 'ipv6');
  }
  return !blocked.check(ip, 'ipv4');
}

const STRICT_PORTS = new Set([80, 443, 8080, 8443]);

/** Kebijakan ketat (bawaan) dan longgar (URL_IMPORT_ALLOW_PRIVATE=true, mis. untuk wiki internal). */
export const STRICT_POLICY = Object.freeze({ address: isPublicAddress, port: (port) => STRICT_PORTS.has(port) });
export const PERMISSIVE_POLICY = Object.freeze({ address: (ip) => isIP(ip) !== 0, port: () => true });
