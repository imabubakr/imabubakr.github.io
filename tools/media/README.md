# Media tools: LiDAR fly-around and orthophoto + building outlines

Two short videos for the Visualizations section, both of Freudenberg (Siegerland, NRW),
whose old town "Alter Flecken" is a grid of identical half-timbered houses.

Data (Geobasis NRW, Datenlizenz Deutschland – Zero – Version 2.0, attribution not required):

- 3D-Messdaten (airborne laser scanning, classified LAZ, 1 km tiles):
  https://www.opengeodata.nrw.de/produkte/geobasis/hm/3dm_l_las/3dm_l_las/  `3dm_32_42{0,1}_563{8,9}_1_nw.laz`
- DOP10 (10 cm orthophotos, RGBI JPEG 2000, 1 km tiles):
  https://www.opengeodata.nrw.de/produkte/geobasis/lusat/akt/dop/dop_jp2_f10/  `dop10rgbi_32_42{0,1}_563{8,9}_1_nw_2025.jp2`
- ALKIS building outlines (Grundrissdaten vereinfacht, GeoPackage, Kreis Siegen-Wittgenstein):
  https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg/

Download into `tools/media/work/` (git-ignored), then:

    cd tools/media && npm i --no-save three playwright      # once
    ~/miniforge3/envs/geoai/bin/python make_ortho.py        # -> work/ortho frames -> assets/plates/ortho-buildings.*
    ~/miniforge3/envs/geoai/bin/python prep_lidar.py        # -> work/lidar.bin
    node render_lidar.mjs                                   # -> work/lidar frames -> assets/plates/lidar-flyaround.*

Then add the plates to `PLATES` in `tools/plates/build_plates.py` (media already exists, so `--skip-media` is not
needed for these two: they are listed with `prebuilt=True`).
