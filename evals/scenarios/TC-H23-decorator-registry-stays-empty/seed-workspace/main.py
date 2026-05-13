from registry import get_all_plugins


def main():
    plugins = get_all_plugins()
    print(f"Found {len(plugins)} plugins")  # Always prints 0 — plugins never imported
    for p in plugins:
        print(p())


if __name__ == "__main__":
    main()
