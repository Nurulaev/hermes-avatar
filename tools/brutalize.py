import json,struct,io,os,sys,numpy as np
from PIL import Image,ImageDraw,ImageFilter
T=os.environ['TMPDIR']+'/brut/'
src,dst=sys.argv[1],sys.argv[2]
d=open(src,'rb').read()
l=struct.unpack('<I',d[12:16])[0]
j=json.loads(d[20:20+l]); b0=20+l+8; binlen=struct.unpack('<I',d[20+l:24+l])[0]
binb=bytearray(d[b0:b0+binlen])
def get(i):
  bv=j['bufferViews'][j['images'][i]['bufferView']];o=bv.get('byteOffset',0)
  return Image.open(io.BytesIO(binb[o:o+bv['byteLength']])).convert('RGBA')
TAN=np.array([0.86,0.72,0.60])
def tan(a):
  a=a.astype(np.float32); a[...,:3]*=TAN; return a
# face
f=get(8); a=tan(np.array(f)); H,W=a.shape[:2]
yy,xx=np.mgrid[0:H,0:W]
# stubble mask: lower face ellipse, fades upward
m=(((xx-512)/340)**2+((yy-820)/190)**2)<1
up=np.clip((yy-690)/50,0,1)
mask=m*up
mask=np.array(Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)))/255.
rng=np.random.default_rng(7)
noise=rng.random((H,W))
dots=(noise>0.62).astype(np.float32)
dots=np.array(Image.fromarray((dots*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5)))/255.
shade=mask*(0.10+0.30*dots)
a[...,:3]*= (1-shade[...,None]*np.array([0.55,0.6,0.62]))
# keep lip line visible: no-op (dark already)
img=Image.fromarray(np.clip(a,0,255).astype(np.uint8))
# scar: image-left side, across brow and cheek
sc=Image.new('L',(W,H),0); dr=ImageDraw.Draw(sc)
pts=[(318,432),(338,470)]; pts2=[(352,600),(372,640),(392,690)]
for p in (pts,pts2): dr.line(p,fill=255,width=9,joint='curve')
sc=np.array(sc.filter(ImageFilter.GaussianBlur(2)))/255.
hl=Image.new('L',(W,H),0); dh=ImageDraw.Draw(hl)
for p in (pts,pts2): dh.line([(x-2,y) for x,y in p],fill=255,width=3)
hl=np.array(hl.filter(ImageFilter.GaussianBlur(1)))/255.
b=np.array(img).astype(np.float32)
scar=np.array([150,78,70.]); light=np.array([235,190,170.])
b[...,:3]=b[...,:3]*(1-sc[...,None]*0.8)+scar*sc[...,None]*0.8
b[...,:3]=b[...,:3]*(1-hl[...,None]*0.5)+light*hl[...,None]*0.5
face=Image.fromarray(np.clip(b,0,255).astype(np.uint8)); face.save(T+'face_new.png')
body=Image.fromarray(np.clip(tan(np.array(get(15))),0,255).astype(np.uint8)); body.save(T+'body_new.png')
# repack: append new images to end of bin
def put(i,im):
  global binb
  buf=io.BytesIO(); im.save(buf,'PNG',optimize=True); data=buf.getvalue()
  while len(binb)%4: binb.append(0)
  j['bufferViews'].append({'buffer':0,'byteOffset':len(binb),'byteLength':len(data)})
  binb+=data; j['images'][i]['bufferView']=len(j['bufferViews'])-1
put(8,face); put(15,body)
while len(binb)%4: binb.append(0)
j['buffers'][0]['byteLength']=len(binb)
js=json.dumps(j,separators=(',',':')).encode()
while len(js)%4: js+=b' '
out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(binb))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(binb),0x004E4942)+bytes(binb)
open(dst,'wb').write(out); print('ok',len(out))
