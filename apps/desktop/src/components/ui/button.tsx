import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Cartoon: an ink outline and a hard drop that the button presses down into.
const TOON =
  "border-ink shadow-[0_3px_0_var(--ink)] hover:-translate-y-px hover:shadow-[0_4px_0_var(--ink)] active:not-aria-[haspopup]:translate-y-[3px] active:not-aria-[haspopup]:shadow-none"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border-[2.5px] border-transparent text-sm font-semibold whitespace-nowrap transition-[translate,box-shadow,background-color,filter] duration-100 outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[2.5] [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground hover:brightness-105 ${TOON}`,
        outline: `bg-card text-foreground hover:bg-accent aria-expanded:bg-accent ${TOON}`,
        secondary: `bg-secondary text-secondary-foreground hover:brightness-105 aria-expanded:bg-secondary ${TOON}`,
        ghost: "hover:bg-ink/8 aria-expanded:bg-ink/8",
        destructive: `bg-destructive text-white hover:brightness-105 ${TOON}`,
        link: "text-foreground underline decoration-2 underline-offset-4 hover:decoration-ring",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
