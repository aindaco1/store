import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const podmanCandidates = ['/opt/podman/bin/podman', 'podman'];

let bundleCheckCache: boolean | null = null;
let podmanCommandCache: string | null = null;
let podmanSiteImageReady = false;
let podmanEnvironmentCache: NodeJS.ProcessEnv | null = null;

function hostBundlerAvailable() {
  if (bundleCheckCache !== null) return bundleCheckCache;

  try {
    execFileSync('bundle', ['check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    bundleCheckCache = true;
  } catch {
    bundleCheckCache = false;
  }

  return bundleCheckCache;
}

function resolvePodmanCommand() {
  if (podmanCommandCache) return podmanCommandCache;

  for (const candidate of podmanCandidates) {
    if (candidate.includes('/') && !fs.existsSync(candidate)) continue;
    const env = resolvePodmanEnvironment(candidate);
    try {
      execFileSync(candidate, ['info'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env
      });
      podmanCommandCache = candidate;
      return candidate;
    } catch {
      try {
        execFileSync(candidate, ['machine', 'start', 'podman-machine-default'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          env
        });
        execFileSync(candidate, ['info'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          env
        });
        podmanCommandCache = candidate;
        return candidate;
      } catch {
        continue;
      }
    }
  }

  throw new Error(
    'Host Bundler is unavailable and Podman is not reachable. Start the Podman dev stack with ./scripts/dev.sh --podman or install the local Ruby toolchain.'
  );
}

function resolvePodmanEnvironment(podmanCommand: string) {
  if (podmanEnvironmentCache) return podmanEnvironmentCache;

  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const socketPath = execFileSync(
      podmanCommand,
      ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', 'podman-machine-default'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env
      }
    ).trim();
    if (socketPath && fs.existsSync(socketPath)) {
      env.CONTAINER_HOST = `unix://${socketPath}`;
    }
  } catch {
    // Linux/rootless hosts often do not need an explicit Podman machine socket.
  }

  podmanEnvironmentCache = env;
  return podmanEnvironmentCache;
}

function renderFilterInPodman(script: string, input: string, provider: string) {
  const podman = resolvePodmanCommand();
  const podmanEnv = resolvePodmanEnvironment(podman);
  let canExecInRunningContainer = false;

  try {
    const runningState = execFileSync(
      podman,
      ['inspect', '--format', '{{.State.Running}}', 'store-dev-site'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: podmanEnv
      }
    ).trim();
    canExecInRunningContainer = runningState === 'true';
  } catch {
    canExecInRunningContainer = false;
  }

  if (!canExecInRunningContainer) {
    if (!podmanSiteImageReady) {
      try {
        execFileSync(podman, ['image', 'exists', 'localhost/store-dev-site:latest'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          env: podmanEnv
        });
      } catch {
        execFileSync(podman, ['build', '-t', 'localhost/store-dev-site:latest', '-f', 'Containerfile.dev', '.'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          env: podmanEnv
        });
      }
      try {
        execFileSync(podman, ['volume', 'exists', 'store-dev-bundle'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'ignore',
          env: podmanEnv
        });
      } catch {
        execFileSync(podman, ['volume', 'create', 'store-dev-bundle'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          env: podmanEnv
        });
      }
      podmanSiteImageReady = true;
    }

    return execFileSync(
      podman,
      [
        'run',
        '--rm',
        '-v',
        `${repoRoot}:/workspace`,
        '-v',
        'store-dev-bundle:/usr/local/bundle',
        '-e',
        `FILTER_SCRIPT=${script}`,
        '-e',
        `FILTER_INPUT=${input}`,
        '-e',
        `FILTER_PROVIDER=${provider}`,
        'localhost/store-dev-site:latest',
        'bash',
        '-lc',
        'cd /workspace && bundle exec ruby -e "$FILTER_SCRIPT" "$FILTER_INPUT" "$FILTER_PROVIDER"'
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: podmanEnv
      }
    ).trim();
  }

  return execFileSync(
    podman,
    [
      'exec',
      '-i',
      '-e',
      `FILTER_SCRIPT=${script}`,
      '-e',
      `FILTER_INPUT=${input}`,
      '-e',
      `FILTER_PROVIDER=${provider}`,
      'store-dev-site',
      'bash',
      '-lc',
      'cd /workspace && bundle exec ruby -e "$FILTER_SCRIPT" "$FILTER_INPUT" "$FILTER_PROVIDER"'
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: podmanEnv
    }
  ).trim();
}

function renderFilter(method: 'safe_markdownify' | 'approved_embed_src', input: string, provider = '') {
  const script = `
root = Dir.pwd
require 'jekyll'
require 'liquid'
require File.join(root, '_plugins', 'content_safety_filter')
site = Jekyll::Site.new(Jekyll.configuration({
  'source' => root,
  'destination' => '/tmp/store-filter-dest',
  'url' => 'https://shop.dustwave.xyz',
  'quiet' => true
}))
filter = Object.new
filter.extend(Jekyll::ContentSafetyFilter)
result = if '${method}' == 'approved_embed_src'
  filter.approved_embed_src(ARGV[0], ARGV[1])
else
  filter.safe_markdownify(ARGV[0], site.config['url'])
end
puts result
`;

  if (hostBundlerAvailable()) {
    return execFileSync('bundle', ['exec', 'ruby', '-e', script, input, provider], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  }

  return renderFilterInPodman(script, input, provider);
}

describe('content safety filter', () => {
  it('neutralizes javascript markdown links', () => {
    const rendered = renderFilter('safe_markdownify', '[x](javascript:alert(1))');
    expect(rendered).not.toContain('href="javascript:alert(1)"');
    expect(rendered).toContain('href="#"');
  });

  it('neutralizes entity-encoded javascript markdown links', () => {
    const rendered = renderFilter('safe_markdownify', '[x](java&#x73;cript:alert(1))');
    expect(rendered).not.toContain('javascript:alert(1)');
    expect(rendered).toContain('href="#"');
  });

  it('neutralizes protocol-relative markdown links', () => {
    const rendered = renderFilter('safe_markdownify', '[x](//example.com/path)');
    expect(rendered).not.toContain('href="//example.com/path"');
    expect(rendered).toContain('href="#"');
  });

  it('neutralizes data markdown links', () => {
    const rendered = renderFilter('safe_markdownify', '[x](data:text/html,boom)');
    expect(rendered).not.toContain('href="data:text/html,boom"');
    expect(rendered).toContain('href="#"');
  });

  it('keeps external https markdown links opening in a new tab', () => {
    const rendered = renderFilter('safe_markdownify', '[Dust Wave](https://dustwave.xyz)');
    expect(rendered).toContain('href="https://dustwave.xyz"');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noopener noreferrer"');
  });

  it('keeps internal markdown links in the same tab', () => {
    const rendered = renderFilter('safe_markdownify', '[Terms](/terms/)');
    expect(rendered).toContain('href="/terms/"');
    expect(rendered).not.toContain('target="_blank"');
  });

  it('normalizes dashboard-authored emphasis with trailing spaces inside delimiters', () => {
    const rendered = renderFilter(
      'safe_markdownify',
      '**it came out great. **Three very long, **15-hour days **with *behind-the-scenes pics *from here.'
    );

    expect(rendered).toContain('<strong>it came out great.</strong> Three very long');
    expect(rendered).toContain('<strong>15-hour days</strong> with');
    expect(rendered).toContain('<em>behind-the-scenes pics</em> from here');
    expect(rendered).not.toContain('**it came out great.');
  });

  it('normalizes dashboard-authored emphasis with leading spaces inside delimiters', () => {
    const rendered = renderFilter(
      'safe_markdownify',
      'choice.** blake, her brother, is gone,** and flesh.* ooey, gooey flesh…* yuck. this film will be** FIRE, HEAT, GAS,** and** SEVERAL OTHER INFERNAL-THEMED ATTRIBUTES.**'
    );

    expect(rendered).toContain('choice. <strong>blake, her brother, is gone,</strong> and');
    expect(rendered).toContain('flesh. <em>ooey, gooey flesh…</em> yuck');
    expect(rendered).toContain('will be <strong>FIRE, HEAT, GAS,</strong> and <strong>SEVERAL OTHER INFERNAL-THEMED ATTRIBUTES.</strong>');
    expect(rendered).not.toContain('choice.** blake');
    expect(rendered).not.toContain('flesh.* ooey');
    expect(rendered).not.toContain('will be** FIRE');
    expect(rendered).not.toContain('and** SEVERAL');
  });

  it('rejects javascript structured embed urls even when they contain an approved substring', () => {
    const rendered = renderFilter(
      'approved_embed_src',
      'javascript:alert(1)//https://www.youtube.com/embed/abc',
      'youtube'
    );
    expect(rendered).toBe('');
  });

  it('allows approved structured embed urls', () => {
    const rendered = renderFilter(
      'approved_embed_src',
      'https://www.youtube-nocookie.com/embed/abc123',
      'youtube'
    );
    expect(rendered).toBe('https://www.youtube-nocookie.com/embed/abc123');
  });
});
