/**
 * Draws a map's images in WebGL. An image is a grid of cells whose corners are positions in the
 * map's space; the view turns each corner into a point on the screen, and the picture is
 * stretched over the cells.
 */
import { type Extent, globeMesh, makeView, type Space, type ViewState } from "@frontier/geo";

const VERTEX = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_size;
out vec2 v_uv;
void main() {
  vec2 clip = a_pos / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_image;
out vec4 color;
void main() {
  color = texture(u_image, v_uv);
}`;

export class MapsNeedWebGL extends Error {}

export interface DrawnImage {
  id: string;
  extent: Extent;
}

export class MapRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly positions: WebGLBuffer;
  private readonly uvs: WebGLBuffer;
  private readonly indices: WebGLBuffer;
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly loading = new Set<string>();
  private readonly sizeAt: WebGLUniformLocation | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Called when an image has arrived and the map should be drawn again. */
    private readonly onReady: () => void,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true });
    if (!gl) throw new MapsNeedWebGL("Maps need WebGL 2, which this browser does not offer.");
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new MapsNeedWebGL("The map could not be set up on this device.");
    }
    this.program = program;
    this.positions = gl.createBuffer();
    this.uvs = gl.createBuffer();
    this.indices = gl.createBuffer();
    this.sizeAt = gl.getUniformLocation(program, "u_size");
  }

  /** The largest picture this device can draw, in pixels a side. */
  get maxTexture(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  /** Fetches an image once and keeps it as a texture. */
  load(id: string, url: string): void {
    if (this.textures.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    const image = new Image();
    image.onload = () => {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      // Mipmaps keep a large picture from shimmering when it is shown small.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(id, texture);
      this.loading.delete(id);
      this.onReady();
    };
    image.onerror = () => this.loading.delete(id);
    image.src = url;
  }

  /** Draws the given images, first to last, for a screen of `width` by `height` CSS pixels. */
  draw(
    space: Space,
    state: ViewState,
    images: DrawnImage[],
    width: number,
    height: number,
    coarse = false,
  ): void {
    const gl = this.gl;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.sizeAt, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const view = makeView(state, width, height);
    for (const image of images) {
      const texture = this.textures.get(image.id);
      if (!texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, texture);

      if (state.kind === "globe") {
        const mesh = globeMesh(state, width, height, image.extent, coarse);
        if (mesh.triangles.length === 0) continue;
        const count = mesh.positions.length / 2;
        const screen = new Float32Array(mesh.positions.length);
        const hidden = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
          const p = view.projectClamped([mesh.positions[i * 2]!, mesh.positions[i * 2 + 1]!]);
          screen[i * 2] = p.point[0];
          screen[i * 2 + 1] = p.point[1];
          hidden[i] = p.visible ? 0 : 1;
        }
        // A triangle wholly on the far side is left out.
        const kept = new Uint16Array(mesh.triangles.length);
        let n = 0;
        for (let t = 0; t < mesh.triangles.length; t += 3) {
          const a = mesh.triangles[t]!;
          const b = mesh.triangles[t + 1]!;
          const c = mesh.triangles[t + 2]!;
          if (hidden[a] && hidden[b] && hidden[c]) continue;
          kept[n++] = a;
          kept[n++] = b;
          kept[n++] = c;
        }
        this.triangles(screen, mesh.uvs, kept.subarray(0, n));
        continue;
      }

      // On a flat map and on a globe laid flat an image is one rectangle, drawn exactly.
      const [x0, y0, x1, y1] = image.extent;
      const top = state.kind === "plate" ? y1 : y0;
      const bottom = state.kind === "plate" ? y0 : y1;
      const a = view.projectClamped([x0, top]).point;
      const b = view.projectClamped([x1, bottom]).point;
      const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
      const order = new Uint16Array([0, 2, 1, 1, 2, 3]);
      for (const shift of view.repeats()) {
        if (a[0] + shift > width || b[0] + shift < 0) continue;
        this.triangles(
          new Float32Array([
            a[0] + shift,
            a[1],
            b[0] + shift,
            a[1],
            a[0] + shift,
            b[1],
            b[0] + shift,
            b[1],
          ]),
          uvs,
          order,
        );
      }
    }
  }

  private triangles(positions: Float32Array, uvs: Float32Array, indices: Uint16Array): void {
    const gl = this.gl;
    const attribute = (name: string, buffer: WebGLBuffer, data: Float32Array) => {
      const at = gl.getAttribLocation(this.program, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    };
    attribute("a_pos", this.positions, positions);
    attribute("a_uv", this.uvs, uvs);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  }
}
