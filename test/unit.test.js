const { describe, it } = require('node:test');
const assert = require('node:assert');
const { COIN, toFTM, parseFTM } = require('../lib/unit');

describe('unit', () => {
  it('COIN is defined as 10^15', () => {
    assert.strictEqual(COIN, 10n ** 15n);
  });

  it('toFTM formats bigint values with units', () => {
    assert.strictEqual(toFTM(1n * COIN), '1 FTM');
    assert.strictEqual(toFTM(123n * COIN + 456n * 10n ** 12n), '123.456 FTM');
    assert.strictEqual(toFTM(1n * COIN, false), '1');
  });

  it('parseFTM converts decimal values to bigint', () => {
    assert.strictEqual(parseFTM('1.5'), 1n * COIN + 5n * 10n ** 14n);
    assert.strictEqual(parseFTM('0.000001'), 1n * 10n ** 9n);
    assert.strictEqual(parseFTM(5n * COIN), 5n * COIN);
  });

  it('parseFTM rejects values with too many decimal places', () => {
    assert.throws(() => parseFTM('0.1234567890123456'), /Too many decimal places/);
  });
});
