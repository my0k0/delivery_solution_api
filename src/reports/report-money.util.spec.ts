import { calculateOrderMoney } from './report-money.util.js';

describe('report money rules', () => {
  it('calculates the 47,000 plus 3,500 unpaid voucher', () => {
    expect(calculateOrderMoney('47000.00', '3500.00', false, false)).toEqual({
      codToCollect: '50500.00',
      netOwedToShop: '47000.00',
    });
  });

  it('calculates COD 18,000 when delivery was already paid', () => {
    expect(calculateOrderMoney('18000.00', '3500.00', false, true)).toEqual({
      codToCollect: '18000.00',
      netOwedToShop: '14500.00',
    });
  });

  it('calculates the 95,000 plus delivery voucher', () => {
    expect(calculateOrderMoney('95000.00', '3500.00', false, false)).toEqual({
      codToCollect: '98500.00',
      netOwedToShop: '95000.00',
    });
  });

  it('covers all four package/fee paid-flag combinations', () => {
    const results = [
      calculateOrderMoney('100.00', '10.00', false, false),
      calculateOrderMoney('100.00', '10.00', false, true),
      calculateOrderMoney('100.00', '10.00', true, false),
      calculateOrderMoney('100.00', '10.00', true, true),
    ];
    expect(results).toEqual([
      { codToCollect: '110.00', netOwedToShop: '100.00' },
      { codToCollect: '100.00', netOwedToShop: '90.00' },
      { codToCollect: '10.00', netOwedToShop: '0.00' },
      { codToCollect: '0.00', netOwedToShop: '-10.00' },
    ]);
  });

  it('uses integer cents for large decimal values without floating-point rounding', () => {
    expect(calculateOrderMoney('9999999999.99', '0.01', false, false)).toEqual({
      codToCollect: '10000000000.00',
      netOwedToShop: '9999999999.99',
    });
  });

  it('settles a fully advanced COD order to zero net owed, leaving COD untouched', () => {
    expect(calculateOrderMoney('47000.00', '3500.00', false, false, '47000.00')).toEqual({
      codToCollect: '50500.00',
      netOwedToShop: '0.00',
    });
  });

  it('subtracts a partial advance from net owed only, never from COD', () => {
    expect(calculateOrderMoney('47000.00', '3500.00', false, true, '20000.00')).toEqual({
      codToCollect: '47000.00',
      netOwedToShop: '23500.00',
    });
  });

  it('reproduces the pre-advance figures when no advance was paid', () => {
    expect(calculateOrderMoney('47000.00', '3500.00', false, false, '0.00')).toEqual(
      calculateOrderMoney('47000.00', '3500.00', false, false),
    );
  });
});
