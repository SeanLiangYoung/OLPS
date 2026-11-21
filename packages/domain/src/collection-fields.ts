import { Ajv,type ErrorObject,type ValidateFunction } from 'ajv'
import type { FieldDefinition } from './content.js'

const ajv=new Ajv({allErrors:true,strict:false})
ajv.addFormat('calendar-date',{type:'string',validate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value})
ajv.addFormat('external-link',{type:'string',validate:value=>{try{return ['http:','https:','mailto:','tel:'].includes(new URL(value).protocol)}catch{return false}}})
const validators=new Map<string,{shared:ValidateFunction;localized:ValidateFunction}>()
const media={type:'object',additionalProperties:false,required:['mediaId'],properties:{mediaId:{type:'string',minLength:1}}}
const contentRef={type:'object',additionalProperties:false,required:['ref','id'],properties:{ref:{enum:['page','collection','group','item']},id:{type:'string',minLength:1}}}
const richtextNode={type:'object',additionalProperties:false,required:['type'],properties:{type:{type:'string',minLength:1},text:{type:'string'},attrs:{type:'object'},marks:{type:'array',items:{type:'object',additionalProperties:false,required:['type'],properties:{type:{type:'string',minLength:1},attrs:{type:'object'}}}},content:{type:'array',items:{$ref:'#/$defs/richtextNode'}}}}

function valueSchema(field:FieldDefinition):Record<string,unknown>{
  switch(field.type){
    case 'text':return {type:'string',...(field.required?{minLength:1,pattern:'\\S'}:{})}
    case 'richtext':return {type:'object',additionalProperties:false,required:['type'],properties:{type:{const:'doc'},attrs:{type:'object'},content:{type:'array',items:{$ref:'#/$defs/richtextNode'}}}}
    case 'number':return {type:'number'}
    case 'boolean':return {type:'boolean'}
    case 'select':return {type:'string',enum:field.options!.map(option=>option.value)}
    case 'date':return {type:'string',format:'calendar-date'}
    case 'media':return media
    case 'mediaList':return {type:'array',items:media,...(field.required?{minItems:1}:{})}
    case 'reference':return {...contentRef,properties:{...contentRef.properties,ref:{const:'item'}}}
    case 'link':return {oneOf:[{type:'object',additionalProperties:false,required:['kind','target'],properties:{kind:{const:'internal'},target:contentRef}},{type:'object',additionalProperties:false,required:['kind','url','newWindow'],properties:{kind:{const:'external'},url:{type:'string',format:'external-link'},newWindow:{type:'boolean'}}}]}
    case 'table':return {type:'array',...(field.required?{minItems:1}:{}),items:{type:'object',additionalProperties:false,required:field.columns!.map(column=>column.key),properties:Object.fromEntries(field.columns!.map(column=>[column.key,{type:column.type==='number'?'number':'string'}]))}}
  }
}
function fieldsSchema(fields:FieldDefinition[],localized:boolean):object{
  const selected=fields.filter(field=>field.translatable===localized)
  return {type:'object',additionalProperties:false,$defs:{richtextNode},properties:Object.fromEntries(selected.map(field=>[field.key,field.required?valueSchema(field):{anyOf:[valueSchema(field),{type:'null'}]}])),required:selected.filter(field=>field.required).map(field=>field.key)}
}
export function validateCollectionFields(fields:FieldDefinition[],shared:unknown,localized:unknown):ErrorObject[]{
  const key=JSON.stringify(fields)
  let compiled=validators.get(key)
  if(!compiled){compiled={shared:ajv.compile(fieldsSchema(fields,false)),localized:ajv.compile(fieldsSchema(fields,true))};validators.set(key,compiled)}
  const errors:ErrorObject[]=[]
  if(!compiled.shared(shared))errors.push(...(compiled.shared.errors??[]).map(error=>({...error,instancePath:'/meta/fields'+error.instancePath})))
  if(!compiled.localized(localized))errors.push(...(compiled.localized.errors??[]).map(error=>({...error,instancePath:'/locale/fields'+error.instancePath})))
  return errors
}
