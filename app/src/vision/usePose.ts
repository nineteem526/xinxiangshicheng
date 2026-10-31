import { useEffect, useRef, useState, type RefObject } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { ActionRecognizer, type Action } from './actions';
export function usePose(video: RefObject<HTMLVideoElement|null>, active:boolean, onAction:(a:Action)=>void) {
  const recognizer=useRef(new ActionRecognizer()); const callback=useRef(onAction); callback.current=onAction;
  const [status,setStatus]=useState('等待摄像头'); const [detail,setDetail]=useState(''); const [last,setLast]=useState('—');
  useEffect(()=>{ if(!active){setStatus('等待摄像头');return;} let stopped=false, raf=0, model:PoseLandmarker|null=null, lastVideo=-1, lastUi=0;
    (async()=>{try{setStatus('加载姿态模型中'); const files=await FilesetResolver.forVisionTasks('/wasm');
      model=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,minTrackingConfidence:.55});
      if(stopped){model.close();return;} setStatus('姿态模型就绪');
      const loop=()=>{if(stopped)return; const v=video.current; const now=performance.now(); if(v && v.readyState>=2 && v.currentTime!==lastVideo){lastVideo=v.currentTime; const result=model!.detectForVideo(v,now); const p=result.landmarks[0]; if(p){const r=recognizer.current.update(p,now); for(const a of r.actions){setLast(a);callback.current(a);} if(now-lastUi>150){setDetail(r.status);lastUi=now;}}else if(now-lastUi>300){setDetail('未检测到人体');lastUi=now;}} raf=requestAnimationFrame(loop);}; loop();
    }catch(e){setStatus(`姿态模型失败：${(e as Error).message}`);}})(); return()=>{stopped=true;cancelAnimationFrame(raf);model?.close();};
  },[active,video]);
  return {status,detail,last,calibrate:()=>recognizer.current.reset()};
}
