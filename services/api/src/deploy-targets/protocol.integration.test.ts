import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { execFileSync,spawnSync } from 'node:child_process'
import { FtpSrv } from 'ftp-srv'
import { S3Client,CreateBucketCommand,GetObjectCommand,HeadObjectCommand } from '@aws-sdk/client-s3'
import { expect,it } from 'vitest'
import { connectDeployTarget } from './adapters.js'

async function freePort():Promise<number>{const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port}
async function waitPort(port:number):Promise<void>{
  const deadline=Date.now()+30000
  while(Date.now()<deadline){
    if(await new Promise<boolean>(resolve=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false))}))return
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error(`测试服务启动超时：${port}`)
}
it('真实FTPS服务验证证书、上传和删除',async()=>{
  const parent=path.resolve('../../.intermediate/deploy-protocol-tests');await fs.mkdir(parent,{recursive:true})
  const root=await fs.mkdtemp(path.join(parent,'ftps-'));const port=await freePort()
  const keyFile=path.join(root,'key.pem'),certificateFile=path.join(root,'certificate.pem')
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certificateFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'pipe'})
  const serverRoot=path.join(root,'files');await fs.mkdir(serverRoot)
  const certificate=await fs.readFile(certificateFile,'utf8')
  const server=new FtpSrv({url:`ftp://127.0.0.1:${port}`,pasv_url:'127.0.0.1',pasv_min:22100,pasv_max:22199,tls:{key:await fs.readFile(keyFile),cert:certificate}})
  server.on('login',(_input,resolve)=>resolve({root:serverRoot}));await server.listen()
  const adapter=await connectDeployTarget('ftps',{host:'127.0.0.1',port,username:'publisher',password:'test-password',root:'/',ca:certificate})
  try{
    await adapter.upload('nested/index.html',Buffer.from('<h1>Secure website</h1>'),{contentType:'text/html',cacheControl:'no-cache'})
    expect(await fs.readFile(path.join(serverRoot,'nested/index.html'),'utf8')).toBe('<h1>Secure website</h1>')
    await adapter.remove('nested/index.html')
    expect(await fs.stat(path.join(serverRoot,'nested/index.html')).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
  }finally{await adapter.close();await server.close();await fs.rm(root,{recursive:true,force:true})}
},60000)

it('真实OpenSSH SFTP服务验证主机指纹、上传和删除',async()=>{
  const container=`olps-sftp-${randomUUID()}`;const port=await freePort()
  execFileSync('docker',['run','--rm','-d','--name',container,'-p',`127.0.0.1:${port}:22`,'atmoz/sftp:alpine','publisher:test-password:::upload'],{stdio:'pipe'})
  try{
    const deadline=Date.now()+30000
    while(spawnSync('docker',['exec',container,'test','-f','/etc/ssh/ssh_host_ed25519_key.pub']).status!==0){if(Date.now()>deadline)throw new Error('SSH 主机密钥未生成');await new Promise(resolve=>setTimeout(resolve,100))}
    while(spawnSync('docker',['exec',container,'pidof','sshd']).status!==0){if(Date.now()>deadline)throw new Error('SSH 服务未启动');await new Promise(resolve=>setTimeout(resolve,100))}
    await waitPort(port)
    const fingerprint=execFileSync('docker',['exec',container,'ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub','-E','sha256'],{encoding:'utf8'}).trim().split(/\s+/)[1]
    const adapter=await connectDeployTarget('sftp',{host:'127.0.0.1',port,username:'publisher',password:'test-password',root:'/upload',hostKeySha256:fingerprint,hostKeyAlgorithm:'ssh-ed25519'})
    try{
      await adapter.upload('nested/index.html',Buffer.from('<h1>SFTP website</h1>'),{contentType:'text/html',cacheControl:'no-cache'})
      expect(execFileSync('docker',['exec',container,'cat','/home/publisher/upload/nested/index.html'],{encoding:'utf8'})).toBe('<h1>SFTP website</h1>')
      await adapter.remove('nested/index.html')
      expect(spawnSync('docker',['exec',container,'test','-e','/home/publisher/upload/nested/index.html']).status).toBe(1)
    }finally{await adapter.close()}
    await expect(connectDeployTarget('sftp',{host:'127.0.0.1',port,username:'publisher',password:'test-password',root:'/upload',hostKeySha256:'SHA256:invalid',hostKeyAlgorithm:'ssh-ed25519'})).rejects.toThrow()
  }finally{execFileSync('docker',['rm','-f',container],{stdio:'pipe'})}
},90000)

it('真实RustFS服务验证S3上传、Content-Type、缓存和删除',async()=>{
  const container=`olps-s3-${randomUUID()}`;const port=await freePort()
  execFileSync('docker',['run','--rm','-d','--name',container,'-p',`127.0.0.1:${port}:9000`,'-e','RUSTFS_ACCESS_KEY=publisher','-e','RUSTFS_SECRET_KEY=test-password','rustfs/rustfs:latest','/data'],{stdio:'pipe'})
  const endpoint=`http://127.0.0.1:${port}`
  const client=new S3Client({endpoint,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'publisher',secretAccessKey:'test-password'}})
  try{
    await waitPort(port)
    const deadline=Date.now()+30000
    while(true){
      try{const response=await fetch(`${endpoint}/minio/health/ready`);if(response.ok && (await response.json() as {ready?:boolean}).ready)break}catch(error){if(!(error instanceof TypeError))throw error}
      if(Date.now()>deadline)throw new Error('对象存储服务未就绪')
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    await client.send(new CreateBucketCommand({Bucket:'website'}))
    const adapter=await connectDeployTarget('s3',{endpoint,region:'us-east-1',forcePathStyle:true,accessKeyId:'publisher',secretAccessKey:'test-password',bucket:'website',prefix:'published'})
    try{
      await adapter.upload('nested/index.html',Buffer.from('<h1>Object website</h1>'),{contentType:'text/html',cacheControl:'public,max-age=31536000,immutable'})
      const object=await client.send(new GetObjectCommand({Bucket:'website',Key:'published/nested/index.html'}))
      expect(await object.Body!.transformToString()).toBe('<h1>Object website</h1>')
      expect(object.ContentType).toBe('text/html');expect(object.CacheControl).toBe('public,max-age=31536000,immutable')
      await adapter.remove('nested/index.html')
      await expect(client.send(new HeadObjectCommand({Bucket:'website',Key:'published/nested/index.html'}))).rejects.toThrow()
    }finally{await adapter.close()}
  }finally{client.destroy();execFileSync('docker',['rm','-f',container],{stdio:'pipe'})}
},90000)
