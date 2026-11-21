function copy<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T}

export class EditorHistory<T>{
  private snapshots:T[]
  private cursor=0
  constructor(initial:T){this.snapshots=[copy(initial)]}
  get current():T{return copy(this.snapshots[this.cursor])}
  get canUndo():boolean{return this.cursor>0}
  get canRedo():boolean{return this.cursor<this.snapshots.length-1}
  apply(value:T):T{
    if(JSON.stringify(value)===JSON.stringify(this.snapshots[this.cursor]))return this.current
    this.snapshots=this.snapshots.slice(0,this.cursor+1)
    this.snapshots.push(copy(value))
    this.cursor++
    return this.current
  }
  undo():T{if(this.canUndo)this.cursor--;return this.current}
  redo():T{if(this.canRedo)this.cursor++;return this.current}
  replaceCurrent(value:T):T{this.snapshots[this.cursor]=copy(value);return this.current}
}
