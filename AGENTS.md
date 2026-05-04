# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 16 application using TypeScript, React 19, Tailwind CSS 4, and shadcn-style UI components. App routes and top-level layouts live in `app/`; the current main screen is `app/page.tsx` with global styles in `app/globals.css`. Reusable feature components live in `components/`, while generated or shared primitives live in `components/ui/`. Hooks are in `hooks/`, helpers are in `lib/`, and static assets such as SVG placeholders and icons are in `public/`. The `@/*` path alias maps to the repository root.

## Build, Test, and Development Commands

Use pnpm because this repository includes `pnpm-lock.yaml`.

- `pnpm install`: install dependencies.
- `pnpm dev`: start the local Next.js development server.
- `pnpm build`: create a production build and catch framework/type integration issues.
- `pnpm start`: run the production build after `pnpm build`.
- `pnpm lint`: run ESLint over the project.

## Coding Style & Naming Conventions

Write TypeScript and TSX with strict type checking in mind. Prefer functional React components, hooks, and the existing `@/` imports. Keep filenames lowercase with hyphens for components and utilities, such as `chat-message.tsx` and `use-mobile.ts`. Component exports should use PascalCase; hooks should start with `use`. Follow the existing style: two-space indentation, no semicolons, double quotes, and Tailwind utility classes for styling. Use `lucide-react` icons and the existing `components/ui/` primitives before adding custom UI patterns.

## Testing Guidelines

No test runner is currently configured. Before adding tests, introduce a project-level script such as `pnpm test` and document the selected framework. For React behavior, prefer colocated tests named `*.test.tsx` or `*.spec.tsx`; for utilities, use `*.test.ts`. At minimum, run `pnpm lint` and `pnpm build` before opening a pull request.

## Commit & Pull Request Guidelines

This directory is not currently initialized as a Git repository, so no project history is available to infer commit conventions. Use concise, imperative commit subjects, for example `Add chat input loading state` or `Fix sidebar mobile toggle`. Pull requests should include a short summary, verification steps, linked issues when applicable, and screenshots or screen recordings for visible UI changes.

## Security & Configuration Tips

Keep secrets out of source files and commit only safe defaults. Use `.env.local` for local environment variables and document required keys without values. Do not edit generated Next.js files such as `next-env.d.ts` unless the framework requires it.
