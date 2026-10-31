import { useEffect, useRef } from 'react';
import * as THREE from 'three';
export function Arena({theme,hit,phase}:{theme:'lava'|'digital';hit:number;phase:string}) {
 const host=useRef<HTMLDivElement>(null); const live=useRef({theme,hit,phase});live.current={theme,hit,phase};
 useEffect(()=>{const el=host.current!; const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x040710,.035);
 const camera=new THREE.PerspectiveCamera(46,1,.1,100);camera.position.set(0,4.1,12);camera.lookAt(0,2,0);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0x83dfff,0x1c0925,2)); const light=new THREE.PointLight(0xff365e,100,25);light.position.set(0,5,4);scene.add(light);
 const floor=new THREE.Mesh(new THREE.CircleGeometry(9,64),new THREE.MeshStandardMaterial({color:0x090d19,metalness:.8,roughness:.28}));floor.rotation.x=-Math.PI/2;scene.add(floor);
 const grid=new THREE.GridHelper(18,24,0x20eeff,0x15223c);grid.position.y=.02;scene.add(grid);
 const boss=new THREE.Group();scene.add(boss);boss.position.y=2.7;
 const shell=new THREE.Mesh(new THREE.IcosahedronGeometry(1.35,2),new THREE.MeshStandardMaterial({color:0x250d2f,metalness:.8,roughness:.3,flatShading:true}));boss.add(shell);
 const wire=new THREE.Mesh(new THREE.IcosahedronGeometry(1.42,1),new THREE.MeshBasicMaterial({color:0xff395e,wireframe:true,transparent:true,opacity:.65}));boss.add(wire);
 const eye=new THREE.Mesh(new THREE.SphereGeometry(.38,24,16),new THREE.MeshBasicMaterial({color:0xffffff}));eye.position.set(0,.12,1.22);boss.add(eye);
 const iris=new THREE.Mesh(new THREE.SphereGeometry(.18,20,12),new THREE.MeshBasicMaterial({color:0xff3267}));iris.position.set(0,.12,1.53);boss.add(iris);
 const rings=[1.8,2.15].map((r,i)=>{const m=new THREE.Mesh(new THREE.TorusGeometry(r,.035,8,80),new THREE.MeshBasicMaterial({color:i?0x46f9ff:0xff4060}));boss.add(m);m.rotation.x=i?1.1:.4;return m;});
 for(let i=0;i<22;i++){const a=i*Math.PI*2/22, h=1.2+(i%5)*.65;const p=new THREE.Mesh(new THREE.BoxGeometry(.3,h,.3),new THREE.MeshStandardMaterial({color:0x141d31,emissive:0x0a3240,metalness:.8}));p.position.set(Math.sin(a)*7,h/2,Math.cos(a)*7);scene.add(p);}
 const lava=new THREE.Group(),digital=new THREE.Group();scene.add(lava,digital);for(let i=0;i<8;i++){const a=i*Math.PI/4;const rock=new THREE.Mesh(new THREE.ConeGeometry(.55,2.4+(i%3),5),new THREE.MeshStandardMaterial({color:0x35101a,emissive:0x70100a,flatShading:true}));rock.position.set(Math.sin(a)*5.6,1,Math.cos(a)*5.6);lava.add(rock);const tower=new THREE.Mesh(new THREE.BoxGeometry(.65,3+(i%3)*.7,.65),new THREE.MeshStandardMaterial({color:0x09172b,emissive:0x045568,wireframe:true}));tower.position.set(Math.sin(a)*5.6,1.6,Math.cos(a)*5.6);digital.add(tower);}const particles=new THREE.BufferGeometry();const arr=new Float32Array(600);for(let i=0;i<arr.length;i+=3){arr[i]=(Math.random()-.5)*18;arr[i+1]=Math.random()*8;arr[i+2]=(Math.random()-.5)*18;}particles.setAttribute('position',new THREE.BufferAttribute(arr,3));const stars=new THREE.Points(particles,new THREE.PointsMaterial({color:0x66faff,size:.05}));scene.add(stars);
 let frame=0, previousHit=0, pulse=0; const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();};window.addEventListener('resize',resize);resize();
 const tick=(t:number)=>{frame=requestAnimationFrame(tick);const s=live.current;lava.visible=s.theme==='lava';digital.visible=s.theme==='digital'; if(s.hit!==previousHit){pulse=1;previousHit=s.hit;} pulse*=.9;boss.position.y=2.7+Math.sin(t*.0015)*.18;boss.rotation.y=t*.0003;boss.scale.setScalar(1+pulse*.12);rings[0].rotation.z=t*.0005;rings[1].rotation.y=t*.0007;wire.material.color.setHex(s.theme==='lava'?0xff385e:0x29faff);light.color.setHex(s.theme==='lava'?0xff385e:0x20dfff);eye.material.color.setHex(pulse>.2?0xffffff:s.theme==='lava'?0xffbfac:0xc4ffff);stars.rotation.y=t*.00002;renderer.render(scene,camera);};frame=requestAnimationFrame(tick);
 return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);scene.traverse(o=>{if(o instanceof THREE.Mesh || o instanceof THREE.Points){o.geometry.dispose();const mat=o.material; (Array.isArray(mat)?mat:[mat]).forEach((m:THREE.Material)=>m.dispose());}});renderer.dispose();el.removeChild(renderer.domElement);};},[]);
 return <div className="arena" ref={host}/>;
}

