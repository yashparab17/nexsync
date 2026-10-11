import * as React from "react";
import {
  composeRenderProps,
  TextArea as TextareaPrimitive,
} from "react-aria-components";

import { cn } from "@/lib/utils";

// Multi-line text area input component
function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof TextareaPrimitive>) {
  return (
    <TextareaPrimitive
      data-slot="textarea"
      autoComplete="off"
      className={composeRenderProps(className, (className) =>
        cn(
          "flex field-sizing-content min-h-20 w-full resize-none rounded-none border border-input bg-card px-3 py-2 text-base transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
          className
        )
      )}
      {...props}
    />
  );
}

export { Textarea };
