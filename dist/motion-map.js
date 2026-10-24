// A cached geographic texture keeps camera movement on the GPU. The still frame
// is redrawn from the original vector geometry by app.js when movement finishes.
export function createMotionMap(){
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
  if(!gl)return null;
  const vertex=`attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  const fragment=`precision highp float;
  uniform sampler2D atlas;uniform vec2 resolution,translation;uniform float scale,blend;uniform mat3 inverseRotation;
  const float PI=3.14159265359;
  vec2 raw(vec2 p){return mix(vec2(cos(p.y)*sin(p.x),sin(p.y)),vec2(p.x,log(tan(PI*.25+clamp(p.y,-1.569,1.569)*.5))),blend);}
  void main(){
    vec2 q=(vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y)-translation)/scale;q.y=-q.y;
    vec2 p;
    if(blend<.0001){float r=dot(q,q);if(r>1.){gl_FragColor=vec4(.945,.949,.914,1.);return;}p=vec2(atan(q.x,sqrt(max(0.,1.-r))),asin(clamp(q.y,-1.,1.)));}
    else if(blend>.9999){p=vec2(q.x,2.*atan(exp(clamp(q.y,-20.,20.)))-PI*.5);}
    else{
      float r=dot(q,q);vec2 o=vec2(atan(q.x,sqrt(max(.0001,1.-r))),asin(clamp(q.y,-.999,.999)));
      p=mix(o,vec2(q.x,2.*atan(exp(clamp(q.y,-10.,10.)))-PI*.5),blend);
      for(int i=0;i<14;i++){vec2 v=raw(p),e=v-q;vec2 dx=(raw(p+vec2(.0001,0.))-v)/.0001,dy=(raw(p+vec2(0.,.0001))-v)/.0001;float det=dx.x*dy.y-dy.x*dx.y;if(abs(det)<.00001)break;vec2 delta=vec2((e.x*dy.y-e.y*dy.x)/det,(e.y*dx.x-e.x*dx.y)/det);p-=clamp(delta,vec2(-.5),vec2(.5));p.y=clamp(p.y,-1.569,1.569);}
      if(length(raw(p)-q)>.025){gl_FragColor=vec4(.945,.949,.914,1.);return;}
    }
    vec3 rotated=vec3(cos(p.y)*cos(p.x),cos(p.y)*sin(p.x),sin(p.y));
    if(abs(p.x)>PI||rotated.x<cos((90.+89.99*blend)*PI/180.)){gl_FragColor=vec4(.945,.949,.914,1.);return;}
    vec3 v=inverseRotation*rotated;vec2 uv=vec2(atan(v.y,v.x)/(2.*PI)+.5,asin(clamp(v.z,-1.,1.))/PI+.5);
    vec4 tex=texture2D(atlas,uv);vec3 color;
    if(tex.a<.2){float light=clamp(.72+.24*rotated.x+.12*rotated.z-.08*rotated.y,0.,1.);color=mix(vec3(.141,.302,.282)*light,vec3(.929,.941,.89),blend);}
    else if(tex.g>.7&&tex.b<.60)color=vec3(.694,.808,.474);
    else if(tex.g<.7)color=mix(vec3(.16,.32,.26),tex.rgb,blend);
    else color=mix(vec3(.494,.667,.565),tex.rgb,blend);
    if(blend<.98)color*=mix(.69+.31*sqrt(max(0.,rotated.x)),1.,blend);
    gl_FragColor=vec4(color,1.);
  }`;
  function shader(type,code){const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Map shader unavailable');return s;}
  let program;
  try{program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;}catch{return null;}
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const attribute=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  const uniforms=Object.fromEntries(['atlas','resolution','translation','scale','blend','inverseRotation'].map(n=>[n,gl.getUniformLocation(program,n)]));let dataKey=null,baseMap=null;
  return {
    canvas,
    setData(layers,key,baseCount=0){
      if(key===dataKey)return false;const start=performance.now();
      const map=document.createElement('canvas');map.width=4096;map.height=2048;const c=map.getContext('2d'),p=d3.geoEquirectangular().scale(4096/(2*Math.PI)).translate([2048,1024]),path=d3.geoPath(p,c);
      const paint=layer=>{c.beginPath();path(layer.feature);c.fillStyle=layer.fill;c.fill();if(layer.stroke!==false){c.strokeStyle=layer.stroke||'#7d9479';c.lineWidth=1;c.stroke();}};
      if(baseCount&&!baseMap){for(const layer of layers.slice(0,baseCount))paint(layer);baseMap=document.createElement('canvas');baseMap.width=map.width;baseMap.height=map.height;baseMap.getContext('2d').drawImage(map,0,0);}
      if(baseMap)c.drawImage(baseMap,0,0);
      for(const layer of layers.slice(baseMap?baseCount:0))paint(layer);
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,map);dataKey=key;return performance.now()-start;
    },
    render({width,height,ratio,scale,translate,rotate,blend}){
      const w=Math.round(width*ratio),h=Math.round(height*ratio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.useProgram(program);gl.bindTexture(gl.TEXTURE_2D,texture);
      const rotation=d3.geoRotation(rotate),cart=coord=>{const p=rotation(coord),l=p[0]*Math.PI/180,f=p[1]*Math.PI/180;return[Math.cos(f)*Math.cos(l),Math.cos(f)*Math.sin(l),Math.sin(f)];},a=cart([0,0]),b=cart([90,0]),c=cart([0,90]);
      gl.uniform1i(uniforms.atlas,0);gl.uniform2f(uniforms.resolution,w,h);gl.uniform2f(uniforms.translation,translate[0]*ratio,translate[1]*ratio);gl.uniform1f(uniforms.scale,scale*ratio);gl.uniform1f(uniforms.blend,blend);gl.uniformMatrix3fv(uniforms.inverseRotation,false,new Float32Array([a[0],b[0],c[0],a[1],b[1],c[1],a[2],b[2],c[2]]));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return canvas;
    }
  };
}
