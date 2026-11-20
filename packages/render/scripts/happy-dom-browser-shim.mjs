export class Window {
  constructor() {
    throw new Error('浏览器环境应使用 document.implementation，不应构造 happy-dom Window')
  }
}
