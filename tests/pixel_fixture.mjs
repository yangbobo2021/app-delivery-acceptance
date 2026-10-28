// Synthetic observation fixture, generated with Node only. The random text is
// intentionally absent from the reviewer's prompt and filename.
import fs from 'node:fs';
import {deflateSync} from 'node:zlib';
export function pixelFixture(file,text){
  const width=1100,height=650,pixels=Buffer.alloc(width*height*3,255);
  const point=(x,y,c)=>{if(x>=0&&y>=0&&x<width&&y<height){const p=(y*width+x)*3;pixels[p]=c[0];pixels[p+1]=c[1];pixels[p+2]=c[2];}};
  const rect=(x,y,w,h,c)=>{for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)point(col,row,c);};
  rect(30,30,130,130,[240,0,0]);
  for(let y=460;y<=620;y++)for(let x=880;x<=1040;x++)if((x-960)**2+(y-540)**2<=80**2)point(x,y,[0,0,240]);
  const font={V:['10001','10001','10001','10001','10001','01010','00100'],
    0:['01110','10001','10011','10101','11001','10001','01110'],1:['00100','01100','00100','00100','00100','00100','01110'],
    2:['01110','10001','00001','00010','00100','01000','11111'],3:['11110','00001','00001','01110','00001','00001','11110'],
    4:['00010','00110','01010','10010','11111','00010','00010'],5:['11111','10000','10000','11110','00001','00001','11110'],
    6:['01110','10000','10000','11110','10001','10001','01110'],7:['11111','00001','00010','00100','01000','01000','01000'],
    8:['01110','10001','10001','01110','10001','10001','01110'],9:['01110','10001','10001','01111','00001','00001','01110']};
  [...text].forEach((char,index)=>font[char].forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='1')rect(140+index*96+x*16,240+y*16,16,16,[0,0,0]);})));
  const crc=buffer=>{let c=0xffffffff;for(const byte of buffer){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(raw,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
