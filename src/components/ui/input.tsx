import * as React from "react";
import {
  composeRenderProps,
  Input as InputPrimitive,
} from "react-aria-components";

import { cn } from "@/lib/utils";

// Styled text input field
function Input({
  className,
  type,
  ...props
}: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      autoComplete="off"
      className={composeRenderProps(className, (className) =>
        cn(
          "h-10 w-full min-w-0 border border-input bg-input px-3 py-1 text-sm transition-[color,border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
          className
        )
      )}
      {...props}
    />
  );
}

export { Input };
