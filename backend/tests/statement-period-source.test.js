import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {extractDeterministicFinancials} from '../services/financial-validator.service.js';

const read = name => fs.readFileSync(path.resolve('backend/tests/fixtures/real-layouts',name),'utf8');
describe('quarter end from the actual statement header',()=>{
  it.each([
    ['HBL_q2fy27-native.txt',871.56],
    ['SHAKTIPUMP_q2fy27-native.txt',746.03]
  ])('%s retains the printed September 2026 quarter end', (name,revenue)=>{
    const fin=extractDeterministicFinancials(read(name),{periodEndHint:new Date('2026-09-30')});
    expect(fin?.revenue).toBe(revenue);
    expect(fin?.quarterEnded).toBe('2026-09-30');
  });
});
