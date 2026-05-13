from registry import register


@register
def plugin_a():
    return "Plugin A output"
