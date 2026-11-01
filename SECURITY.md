# Security policy

## Supported versions

Only the latest release and the current `main` receive fixes. There is no
maintenance branch.

## Reporting a vulnerability

Report privately, not through a public issue: open the repository's
[**Security** tab](https://github.com/kodetix-fr/obturo/security/advisories/new)
and use *Report a vulnerability*. The report stays visible only to you and the
maintainers until a fix is published.

Useful in a report:

- what an attacker gains, and what they need to already have
- the affected file or code path
- the steps that demonstrate it, with the version of Obturo (the one in
  `manifest.json`) and of Chrome

Expect an acknowledgement within a week. This is a small project maintained on
free time: there is no bounty, and fixes ship when they are ready. Please hold
public disclosure until a fix is out, or for 90 days, whichever comes first.

## Scope

Obturo is a local extension. It has no server, no account and no telemetry, it
makes no network request, and it keeps its data in the browser's IndexedDB,
unencrypted, as [docs/PRIVACY.md](docs/PRIVACY.md) says. Its permissions are
`activeTab`, `scripting` and `contextMenus`, nothing more.

In scope, and worth reporting:

- code execution or HTML interpretation from data of the captured page (title,
  address, content)
- the service worker, the overlay and the injected scripts: a message that is
  not validated, a privilege escalation, an injection into a page without a
  gesture from the user
- a capture leaking from IndexedDB to another origin, another extension or a web
  page
- a permission, a network access or remote code added by mistake
- the supply chain of the repository: development dependencies, the workflows,
  `vendor/` (Fabric.js) and the packaging script

Out of scope: flaws in Chrome itself, or in Fabric.js upstream (report them to
those projects, and tell us if Obturo is affected, the bundled version will be
updated), access to the captures by someone who already controls the machine or
the browser profile, the content of the pages you capture and what you do with
the images you copy or export, findings from a scanner with no demonstrated
impact, social engineering, and attacks that need a modified extension to be
installed. Pixelated text that can be read back is not a vulnerability either:
the interface says to use the black fill for text.
