#!/usr/bin/env bash
# Build the COGs for the "Accesibilidad dual — Cuenca" dashboard (provisioning-sources).
#
# The inputs are 38 GeoTIFFs from a dual-accessibility study of Cuenca, handed
# over as files rather than published anywhere: one per category of urban
# opportunity (minutes to the nearest one, P50, capped at 120) plus the study's
# aggregate. They are small (300x219 px, float32, EPSG:3857) but striped and
# without overviews, so each is rewritten as a COG under a short Spanish name —
# the name the dashboard's `categoria` variable carries.
#
#     testdata/make-accesibilidad.sh <folder with the def_3eR_*.tif files>
#
# Needs GDAL >= 3.1 (the COG driver). Outputs land in testdata/accesibilidad-cuenca/
# and are NOT committed; sources-data serves them, and TiTiler reads them there.
set -euo pipefail

src=${1:?usage: $0 <folder with the source GeoTIFFs>}
out="$(dirname "$0")/accesibilidad-cuenca"
mkdir -p "$out"

# `<key>` is the part of the source name between the study's group hash and the
# category hash (e.g. `..._e93df2_22_library_e93ba8_P50_C1.dual.tif`); matching
# on it with both hashes around it is what keeps a short key such as `1_river`
# from matching inside a longer one, and a second match is an error, not a pick.
while read -r key slug; do
  if [ "$key" = resultado ]; then
    file="$src/deficit_3eR_Dual_SubcatOpport_resultado.tif"
  else
    matches=$(find "$src" -maxdepth 1 -regextype posix-extended \
      -regex ".*_e9[0-9a-f]{4}_${key}_e9[0-9a-f]{4}_P50_C1\.dual\.tif")
    if [ "$(printf '%s\n' "$matches" | grep -c .)" != 1 ]; then
      echo "expected one source for '$key', found: ${matches:-none}" >&2
      exit 1
    fi
    file=$matches
  fi
  # AVERAGE overviews: nearest ones would drop the thin low-minute corridors
  # along the streets at the zooms that show the whole city.
  gdal_translate -q -of COG -co COMPRESS=DEFLATE -co PREDICTOR=YES \
    -co OVERVIEW_RESAMPLING=AVERAGE -co BLOCKSIZE=256 "$file" "$out/$slug.tif"
  echo "$slug.tif <- $(basename "$file")"
done <<'MAP'
resultado resultado
6_bikepath ciclovia
1_river rio
2_3_epa espacio-publico
5_zoo zoologico
11_pool piscina
13_indoor_play_center juegos-bajo-techo
14_video_game videojuegos
15_spa_party salon-de-fiestas
16_18_icecream_cafe heladeria-cafeteria
17_restaurant restaurante
19_dining_plaza patio-de-comidas
20_theaters teatro
21_commu_center centro-comunitario
22_library biblioteca
23_museum museo
24_art_gallery galeria-de-arte
25_cine cine
26_stadium estadio
27_28_church_catech iglesia-catequesis
29_hairsalon peluqueria
30_pharmacy farmacia
31_33_doctor_dent_terap medico-dentista-terapia
34_bookstore libreria
35_stationery_store papeleria
36_shopping_mall centro-comercial
37_38_neigh_fruit_store tienda-de-barrio-fruteria
39_bakery panaderia
40_supermarket supermercado
41_muni_market mercado-municipal
42_tram_stop parada-de-tranvia
43_bus_stop parada-de-bus
45_bicycle_repair taller-de-bicicletas
46_sport_acad academia-deportiva
47_music_art academia-de-musica-arte
48_languages academia-de-idiomas
49_reinf_scho refuerzo-escolar
51_school escuela
MAP
