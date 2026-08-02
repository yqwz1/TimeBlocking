import { NodeCircleProgram } from 'sigma/rendering';

/**
 * A softer note node than Sigma's flat disc.
 *
 * The quad, picking pass, attributes, and uniforms still come from
 * NodeCircleProgram; only the visible fragment is replaced with a subtly lit
 * centre and a crisp inset rim. Larger animated glows remain on the 2D overlay
 * so this shader stays as cheap as the stock circle program.
 */
const FRAGMENT_SHADER_SOURCE = `precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float feather = u_correctionRatio * 2.0;
  float distanceToEdge = length(v_diffVector) - v_radius + feather;

  #ifdef PICKING_MODE
  if (distanceToEdge > feather)
    gl_FragColor = transparent;
  else
    gl_FragColor = v_color;
  #else
  float edgeAlpha = 1.0;
  if (distanceToEdge > feather)
    edgeAlpha = 0.0;
  else if (distanceToEdge > 0.0)
    edgeAlpha = 1.0 - distanceToEdge / feather;

  float radial = clamp(length(v_diffVector) / max(v_radius, 0.0001), 0.0, 1.0);
  float centreLight = (1.0 - radial) * 0.16;
  float rim = smoothstep(0.70, 0.98, radial) * 0.16;
  vec3 litColor = mix(v_color.rgb, vec3(1.0), centreLight);
  litColor = mix(litColor, max(vec3(0.0), v_color.rgb - vec3(0.09)), rim);

  vec4 shaded = vec4(litColor, v_color.a);
  gl_FragColor = mix(transparent, shaded, edgeAlpha);
  #endif
}`;

export default class NodeAuraProgram extends NodeCircleProgram {
  getDefinition() {
    return { ...super.getDefinition(), FRAGMENT_SHADER_SOURCE };
  }
}
