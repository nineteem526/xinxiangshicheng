import {describe,it,expect} from 'vitest';
import {ActionRecognizer,type Point} from './actions';
const pose=():Point[]=>{const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));p[11]={x:.4,y:.3,z:0,visibility:1};p[12]={x:.6,y:.3,z:0,visibility:1};p[15]={x:.4,y:.6,z:0,visibility:1};p[16]={x:.6,y:.6,z:0,visibility:1};p[23]={x:.44,y:.6,z:0,visibility:1};p[24]={x:.56,y:.6,z:0,visibility:1};return p;};
describe('body action recognition',()=>{
 it('rejects low confidence and recognises a calibrated lean once until reset',()=>{const r=new ActionRecognizer(), p=pose();p[11].visibility=.1;expect(r.update(p,1000).actions).toEqual([]);p[11].visibility=1;r.update(p,1100);for(const i of [11,12,23,24])p[i].x+=.12;expect(r.update(p,1200).actions).toContain('right');expect(r.update(p,1300).actions).not.toContain('right');});
 it('requires sustained raised arms for the special action',()=>{const r=new ActionRecognizer(),p=pose();r.update(p,1000);p[15].y=.1;p[16].y=.1;expect(r.update(p,1100).actions).not.toContain('special');expect(r.update(p,1800).actions).toContain('special');expect(r.update(p,2000).actions).not.toContain('special');});
});
