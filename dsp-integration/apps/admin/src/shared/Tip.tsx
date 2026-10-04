/* Tooltip that works on touch screens. AntD's default hover trigger never
   fires on an iPad (a tap is not a hover), so on a coarse pointer the tip
   opens on tap and stays open until the next tap elsewhere. */
import { Popover, Tooltip, type PopoverProps, type TooltipProps } from 'antd'

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches

export const touchTrigger = (): TooltipProps['trigger'] => (isTouch() ? ['click'] : ['hover', 'focus'])

export function Tip(props: TooltipProps) {
  return <Tooltip trigger={touchTrigger()} {...props} />
}

export function PopTip(props: PopoverProps) {
  return <Popover {...props} trigger={isTouch() ? 'click' : props.trigger} />
}
