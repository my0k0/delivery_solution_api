import {
  MODULE_ACTIONS,
  PERMISSION_KEYS,
  type ModuleName,
} from './permission-keys.js';

/**
 * The catalog is fixed and read-only at runtime, so these counts are the only
 * cheap way to notice a module or an action going missing — and the counts the
 * frontend mirror in `delivery_solution_frontend/src/types/permission.ts` and
 * the docs are written against.
 */
describe('permission catalog', () => {
  it('holds 14 modules and 46 keys', () => {
    const modules = Object.keys(MODULE_ACTIONS) as ModuleName[];

    expect(modules).toHaveLength(14);
    expect(PERMISSION_KEYS).toHaveLength(46);
  });

  it('gives rider handovers exactly create, read and update', () => {
    expect(MODULE_ACTIONS['rider-handovers']).toEqual([
      'create',
      'read',
      'update',
    ]);
  });

  it('never declares the same key twice', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('derives every key as module.action', () => {
    for (const module of Object.keys(MODULE_ACTIONS) as ModuleName[]) {
      for (const action of MODULE_ACTIONS[module]) {
        expect(PERMISSION_KEYS).toContain(`${module}.${action}`);
      }
    }
  });

  it('has no key without an action behind it', () => {
    for (const key of PERMISSION_KEYS) {
      const separator = key.indexOf('.');
      const module = key.slice(0, separator) as ModuleName;
      const action = key.slice(separator + 1);

      expect(Object.keys(MODULE_ACTIONS)).toContain(module);
      expect(MODULE_ACTIONS[module]).toContain(action);
    }
  });
});
