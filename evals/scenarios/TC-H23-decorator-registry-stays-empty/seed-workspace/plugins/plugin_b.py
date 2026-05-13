from registry import register


@register
def plugin_b():
    return "Plugin B output"
