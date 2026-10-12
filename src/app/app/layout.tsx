/*
  Every page in the client app depends on who is signed in, so these routes
  render at request time and navigation waits for the server instead of
  flashing loading states. See AGENTS.md.
*/
export const instant = false;

export default function ClientRootLayout({ children }: LayoutProps<"/app">) {
  return children;
}
