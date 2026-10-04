const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Mengubah entitas XML (&amp;, &#10;, &#x41;) menjadi karakternya. Entitas yang tak dikenal dibiarkan. */
export function decodeXml(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (whole, dec, hex, name) => {
    if (name) return NAMED[name] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
