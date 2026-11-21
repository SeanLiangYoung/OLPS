import { Readable } from 'node:stream'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Client as FtpClient } from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'
import { S3Client,PutObjectCommand,DeleteObjectCommand,HeadBucketCommand } from '@aws-sdk/client-s3'
import OSS from 'ali-oss'
import COS from 'cos-nodejs-sdk-v5'
import { z } from 'zod'

export type DeployType='ftp'|'ftps'|'sftp'|'s3'|'oss'|'cos'
export type UploadMetadata={contentType:string;cacheControl:string}
export type DeployAdapter={test():Promise<void>;upload(file:string,bytes:Buffer,metadata:UploadMetadata):Promise<void>;remove(file:string):Promise<void>;close():Promise<void>}
const pathSchema=z.string().refine(value=>!value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..'),'目标路径无效')
const transferConfig=z.object({host:z.string().min(1),port:z.number().int().positive().max(65535).optional(),username:z.string().min(1),password:z.string().optional(),privateKey:z.string().optional(),root:pathSchema,hostKeySha256:z.string().optional(),hostKeyAlgorithm:z.enum(['ssh-ed25519','ecdsa-sha2-nistp256','rsa-sha2-512','rsa-sha2-256']).optional(),ca:z.string().optional()}).strict()
const objectConfig=z.object({bucket:z.string().min(1),region:z.string().min(1),accessKeyId:z.string().min(1),secretAccessKey:z.string().min(1),endpoint:z.url().optional(),prefix:pathSchema.default(''),forcePathStyle:z.boolean().default(false),sessionToken:z.string().optional()}).strict()
export function validateDeployConfig(type:DeployType,input:unknown):void{
  if(type==='ftp' || type==='ftps' || type==='sftp'){
    const config=transferConfig.parse(input)
    if(type==='sftp' && !config.hostKeySha256) throw new Error('SFTP 需要服务器 SHA-256 指纹')
    if(!config.password && !config.privateKey) throw new Error('目标缺少登录凭据')
  }else{
    const config=objectConfig.parse(input)
    if(config.endpoint){
      const url=new URL(config.endpoint)
      if(url.username || url.password || (url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('对象存储 endpoint 需要 HTTPS 或本机 HTTP')
    }
  }
}
function safeRelative(file:string):string{
  if(file.startsWith('/') || file.includes('\\') || file.includes('\0') || file.split('/').some(part=>!part || part==='.' || part==='..')) throw new Error('发布文件路径无效')
  return file
}
export async function connectDeployTarget(type:DeployType,input:unknown):Promise<DeployAdapter>{
  validateDeployConfig(type,input)
  if(type==='ftp' || type==='ftps'){
    const config=transferConfig.parse(input)
    const client=new FtpClient(20000)
    try{await client.access({host:config.host,port:config.port??21,user:config.username,password:config.password,secure:type==='ftps',secureOptions:config.ca?{ca:config.ca}:undefined})}catch(error){client.close();throw error}
    const root=path.posix.resolve(await client.pwd(),config.root)
    const destination=(file:string)=>path.posix.join(root,safeRelative(file))
    return{
      async test(){await client.list(root)},
      async upload(file,bytes){const remote=destination(file);await client.ensureDir(path.posix.dirname(remote));await client.uploadFrom(Readable.from(bytes),path.posix.basename(remote))},
      async remove(file){await client.remove(destination(file),true)},
      async close(){client.close()},
    }
  }
  if(type==='sftp'){
    const config=transferConfig.parse(input)
    const client=new SftpClient()
    await client.connect({host:config.host,port:config.port??22,username:config.username,password:config.password,privateKey:config.privateKey,readyTimeout:20000,algorithms:config.hostKeyAlgorithm?{serverHostKey:[config.hostKeyAlgorithm]}:undefined,hostVerifier:(key:Buffer)=>`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/,'')}`===config.hostKeySha256})
    const root=path.posix.resolve(await client.cwd(),config.root)
    const destination=(file:string)=>path.posix.join(root,safeRelative(file))
    return{
      async test(){await client.list(root)},
      async upload(file,bytes){const remote=destination(file);await client.mkdir(path.posix.dirname(remote),true);await client.put(bytes,remote)},
      async remove(file){await client.delete(destination(file),true)},
      async close(){await client.end()},
    }
  }
  const config=objectConfig.parse(input)
  const key=(file:string)=>path.posix.join(config.prefix,safeRelative(file)).replace(/^\/+/, '')
  if(type==='s3'){
    const client=new S3Client({region:config.region,endpoint:config.endpoint,forcePathStyle:config.forcePathStyle,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,sessionToken:config.sessionToken},maxAttempts:3})
    return{
      async test(){await client.send(new HeadBucketCommand({Bucket:config.bucket}))},
      async upload(file,bytes,metadata){await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key(file),Body:bytes,ContentType:metadata.contentType,CacheControl:metadata.cacheControl}))},
      async remove(file){await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:key(file)}))},
      async close(){client.destroy()},
    }
  }
  if(type==='oss'){
    const client=new OSS({bucket:config.bucket,region:config.region,accessKeyId:config.accessKeyId,accessKeySecret:config.secretAccessKey,endpoint:config.endpoint,stsToken:config.sessionToken,secure:true,timeout:20000})
    return{
      async test(){await client.getBucketInfo(config.bucket)},
      async upload(file,bytes,metadata){await client.put(key(file),bytes,{headers:{'Content-Type':metadata.contentType,'Cache-Control':metadata.cacheControl}})},
      async remove(file){await client.delete(key(file))},
      async close(){},
    }
  }
  const client=new COS({SecretId:config.accessKeyId,SecretKey:config.secretAccessKey,SecurityToken:config.sessionToken,Timeout:20000})
  return{
    async test(){await client.headBucket({Bucket:config.bucket,Region:config.region})},
    async upload(file,bytes,metadata){await new Promise<void>((resolve,reject)=>client.putObject({Bucket:config.bucket,Region:config.region,Key:key(file),Body:bytes,ContentType:metadata.contentType,CacheControl:metadata.cacheControl},error=>error?reject(error):resolve()))},
    async remove(file){await new Promise<void>((resolve,reject)=>client.deleteObject({Bucket:config.bucket,Region:config.region,Key:key(file)},error=>error?reject(error):resolve()))},
    async close(){},
  }
}
