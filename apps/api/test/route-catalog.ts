import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every HTTP route the API exposes, read from the controller sources, with the access decorators that
 * guard it. The security suite drives each one as every role and checks the guard behaves as declared.
 */
export interface RouteInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  file: string;
  features: string[];
  anyFeature: boolean;
  isPublic: boolean;
  controllerGuard: string | null;
  /** The decorator spreads a shared list (@RequireAnyFeature(...VIEW)): guarded, exact codes unknown. */
  spread: boolean;
}

const ROUTE_RE = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function joinPath(prefix: string, route: string): string {
  const parts = [prefix, route].filter((x) => x && x.length > 0);
  return (
    '/' +
    parts
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '')
  );
}

export function routeCatalog(
  root = path.join(__dirname, '..', 'src', 'modules'),
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    // Split into classes so prefixes and class-level guards apply to the right handlers.
    const classes = text.split(/(?=@Controller\()/).slice(1);
    for (const block of classes) {
      const prefixMatch = block.match(
        /@Controller\(\s*(?:'([^']*)'|\{[^}]*path:\s*'([^']*)'[^}]*\})?\s*\)/,
      );
      const prefix = prefixMatch?.[1] ?? prefixMatch?.[2] ?? '';
      const head = block.slice(0, block.indexOf('{'));
      const controllerGuard = head.match(/@UseGuards\((\w+)\)/)?.[1] ?? null;
      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(ROUTE_RE);
        if (!m) continue;
        // Decorators sit between the route decorator and the handler signature.
        let j = i + 1;
        const deco: string[] = [];
        while (
          j < lines.length &&
          /^\s*@/.test(lines[j].trim().length ? lines[j] : '@')
        ) {
          deco.push(lines[j]);
          j += 1;
          if (/^\s*@\w+\([^)]*$/.test(lines[j - 1])) {
            // multi-line decorator: swallow until the closing paren
            while (j < lines.length && !/\)\s*$/.test(lines[j - 1])) {
              deco.push(lines[j]);
              j += 1;
            }
          }
        }
        const decoText = deco.join(' ');
        const feat = decoText.match(/@RequireFeature\(([^)]*)\)/);
        const any = decoText.match(/@RequireAnyFeature\(([^)]*)\)/);
        const features = [
          ...(feat?.[1] ?? any?.[1] ?? '').matchAll(/'([^']+)'/g),
        ].map((x) => x[1]);
        routes.push({
          method: m[1].toLowerCase() as RouteInfo['method'],
          path: joinPath(prefix, m[2] ?? ''),
          file: path.relative(root, file),
          features,
          anyFeature: !!any,
          isPublic: /@Public\(\)/.test(decoText),
          controllerGuard,
          spread: /@Require(Any)?Feature\(\s*\.\.\./.test(decoText),
        });
      }
    }
  }
  return routes;
}
