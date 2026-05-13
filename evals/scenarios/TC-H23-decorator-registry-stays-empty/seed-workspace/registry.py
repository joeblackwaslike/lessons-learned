plugins = {}


def register(fn):
    plugins[fn.__name__] = fn
    return fn


def get_all_plugins():
    return list(plugins.values())
