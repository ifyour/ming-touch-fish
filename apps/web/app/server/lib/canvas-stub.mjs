// CF Workers 没有原生 canvas 模块，且文章正文抽取从不使用 <canvas> 元素。
// linkedom 在加载时会 require('canvas')，这里提供等价 shim 以满足打包与运行时引用。
function createCanvas(width = 300, height = 150) {
  return {
    width,
    height,
    getContext: () => null,
    toDataURL: () => '',
    toBuffer: () => new Uint8Array(0),
  };
}

const canvas = { createCanvas };
export default canvas;
export { createCanvas };
