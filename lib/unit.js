const COIN = 10n ** 15n;

function toFTM(amount, withUnit = true) {
  if (typeof amount === 'bigint') {
    const s = amount.toString().padStart(16, '0');
    const intPart = s.slice(0, -15).replace(/^0+/, '') || '0';
    const decPart = s.slice(-15).replace(/0+$/, '');
    return intPart + (decPart ? '.' + decPart : '') + (withUnit ? ' FTM' : '');
  }
  return String(amount) + (withUnit ? ' FTM' : '');
}

function parseFTM(s) {
  if (typeof s === 'bigint') return s;
  const str = String(s);
  const parts = str.split('.');
  const intPart = parts[0].replace(/^0+/, '') || '0';
  const decPart = (parts[1] || '').replace(/0+$/, '');
  if (decPart.length > 15) throw new Error('Too many decimal places (max 15)');
  return BigInt(intPart + decPart.padEnd(15, '0'));
}

module.exports = { COIN, toFTM, parseFTM };
