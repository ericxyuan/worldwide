// Snapshot a supplied, already-rendered map. No external screenshot service or upload is used.
export function renderSnapshot({map,title,english,kind,progress,unit,brand,coverage,now=new Date()},target) {
  const output=target||document.createElement('canvas');
  const exportWidth=1600,padding=64,header=238,footer=135;
  const mapWidth=exportWidth-padding*2, mapHeight=Math.max(460,Math.min(980,Math.round(mapWidth*map.height/map.width)));
  if(output.width!==exportWidth)output.width=exportWidth;if(output.height!==header+mapHeight+footer)output.height=header+mapHeight+footer;
  const ctx=output.getContext('2d');
  ctx.fillStyle='#f4f3ed';ctx.fillRect(0,0,output.width,output.height);
  if(brand?.complete&&brand.naturalWidth)ctx.drawImage(brand,padding,32,64,64);
  ctx.fillStyle='#243e39';ctx.font='34px Georgia,serif';ctx.fillText('Worldwide',padding+80,62);
  ctx.fillStyle='#6f7c70';ctx.font='13px system-ui,sans-serif';ctx.fillText('YOUR PERSONAL ATLAS',padding+82,86);
  ctx.font='13px system-ui,sans-serif';ctx.textAlign='right';ctx.fillText(`${kind.toLocaleUpperCase()} / ${now.toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}`,exportWidth-padding,59);
  ctx.textAlign='left';ctx.fillStyle='#243e39';
  let size=48;do{ctx.font=`500 ${size}px system-ui,sans-serif`;if(ctx.measureText(title).width<mapWidth*.66)break;size-=2;}while(size>22);
  ctx.fillText(title,padding,160);
  ctx.fillStyle='#6f7c70';ctx.font='18px system-ui,sans-serif';ctx.fillText(english!==title?english:'Your discoveries, one place at a time.',padding,196);
  ctx.textAlign='right';ctx.fillStyle='#265b4a';ctx.font='500 44px system-ui,sans-serif';ctx.fillText(`${progress.percentage}% discovered`,exportWidth-padding,151);
  ctx.fillStyle='#6f7c70';ctx.font='18px system-ui,sans-serif';ctx.fillText(`${progress.visited.toLocaleString()} / ${progress.total.toLocaleString()} ${unit} visited`,exportWidth-padding,191);
  ctx.textAlign='left';
  // Fit the exact current map without cropping or changing its projection, pan or rotation.
  const aspect=map.width/map.height,drawWidth=Math.min(mapWidth,mapHeight*aspect),drawHeight=drawWidth/aspect;
  ctx.fillStyle='#edf0e3';ctx.fillRect(padding,header,mapWidth,mapHeight);
  ctx.drawImage(map,padding+(mapWidth-drawWidth)/2,header+(mapHeight-drawHeight)/2,drawWidth,drawHeight);
  const legendY=header+mapHeight+34;
  for(const [x,color,label] of [[padding,'#648874','Unexplored'],[padding+172,'#b1ce79','Visited']]){ctx.beginPath();ctx.arc(x+6,legendY-5,6,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.fillStyle='#536651';ctx.font='16px system-ui,sans-serif';ctx.fillText(label,x+23,legendY);}
  ctx.font='13px system-ui,sans-serif';ctx.fillStyle='#6f7c70';
  const note=coverage.length>170?coverage.slice(0,167)+'…':coverage;ctx.fillText(note,padding,legendY+32);
  ctx.fillText('Natural Earth · GeoNames · © OpenStreetMap contributors / geoBoundaries. See Worldwide data sources for licenses.',padding,legendY+57);
  return {canvas:output,mapFrame:{x:padding+(mapWidth-drawWidth)/2,y:header+(mapHeight-drawHeight)/2,width:drawWidth,height:drawHeight}};
}
export function pngBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The browser could not create a PNG.')),'image/png'));}
