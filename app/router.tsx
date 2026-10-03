import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./navigation";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** An ordinary link that switches pages without reloading. New-tab clicks still work normally. */
export function Link({ href, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handleClick} {...rest} />;
}
