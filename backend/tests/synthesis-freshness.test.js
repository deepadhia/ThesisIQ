import {describe,it,expect} from 'vitest';
import {currentSyntheses} from '../services/synthesis-freshness.service.js';

const report = (source) => ({report_content:`<!-- METADATA_HEADER: { "source_filing_id": "${source}" } -->\n# Report`});
describe('synthesis source freshness',()=>{
 it('keeps only reports written from the current verified filing',()=>{
  expect(currentSyntheses([report('old'),report('current'),{report_content:'# Legacy'}],'current')).toEqual([report('current')]);
 });
 it('withholds reports when no verified source exists or metadata is malformed',()=>{
  expect(currentSyntheses([report('old')],null)).toEqual([]);
  expect(currentSyntheses([{report_content:'<!-- METADATA_HEADER: {broken} -->'}],'current')).toEqual([]);
 });
});
