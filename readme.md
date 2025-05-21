# PoE Map Log Viewer

Simple map metrics from Path of Exile's Client.txt log file. 
All processing is done client side for privacy / performance purposes.


## Usage

1. go to [GitHub Pages](https://bear421.github.io/poe-map-log-viewer/)
2. select your `Client.txt` file
3. View your aggregated data

## Run locally

```bash
npm run dev
``` 

## technical tidbits

- in general, the information supplied by the log file is quite sparse and some stats are inferred on a best effort basis
- load time is attributed to the entered map
- when entering the hideout (i.e. leaving the map), the load time is attributed to the current map
- when transitioning between hideouts and towns, the load time is unattributed
- inaccurate results if user changed system date/time; log file must be chronologically ordered
- legacy PoE 1 map logs "You have entered Strand" (~2020 and before) currently not supported
- leagcy PoE 1 and briefly PoE 2 "@player1 xyz" message fromat (sender / receiver ambiguous) currently not supported

## Disclaimer

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.