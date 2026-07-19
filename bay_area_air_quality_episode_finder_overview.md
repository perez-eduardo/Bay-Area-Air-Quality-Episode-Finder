# Bay Area Air Quality Episode Finder — Initial App Overview

## Project idea

This project is a long-term Google Earth Engine app focused on Bay Area air quality. The app is not meant to compete with official AQI tools or public health advisory websites. Instead, it is meant to show an analytical workflow: how satellite, reanalysis, and ground-monitor evidence can be used to examine whether an air-quality episode may have happened or may be developing.

The working title is:

**Bay Area Air Quality Episode Finder**

The app should help answer questions such as:

- Was there a period when air quality became unusually poor?
- Did the pattern last for more than a short spike?
- Was it localized, or did it affect a wider part of the Bay Area?
- What evidence supports the episode label?
- What are the limitations of the data and method?

## Purpose of the app

The main purpose is to build a transparent Earth-observation and data-analysis project that can be discussed in an interview. The app should show more than a map. It should show the reasoning behind the analysis, the data sources used, and the limitations of the conclusions.

The project should demonstrate:

- use of Google Earth Engine for environmental and geospatial analysis
- air-quality analysis focused on the Bay Area
- clear visual presentation of maps, charts, and summary indicators
- careful handling of assumptions and uncertainty
- documentation that explains how the app was designed
- human judgment in the design, even if coding assistance is used for implementation

## What the app should not claim

The app should not present itself as an official air-quality advisory tool.

It should not claim to replace AirNow, BAAQMD, EPA, or other official sources.

It should not make strong health guidance claims.

It should not overclaim that satellite imagery directly gives ground-level air quality in all cases.

It should not present machine learning output as ground truth.

The app should use careful language such as:

- possible episode
- likely regional episode
- localized anomaly
- evidence suggests
- satellite/reanalysis indicator
- estimate
- limitation
- uncertainty

## Main concept: air-quality episode

The app will use the term **air-quality episode** or **air pollution episode** in a careful way.

For this project, an air-quality episode means a period when pollution indicators are unusually elevated compared with a baseline, persist across multiple days, and affect more than a small isolated area.

The app should make this definition visible to the user. The definition should be treated as the app’s working definition, not as a universal scientific standard for every agency or context.

The app should distinguish between:

- no strong episode signal
- localized anomaly
- possible regional episode
- strong regional episode

## Geographic focus

The initial geographic focus is the **San Francisco Bay Area**.

The app should be designed around Bay Area use cases because:

- the user is currently based in San Jose / Bay Area
- the Bay Area has official air-quality monitoring and public interest in air-quality events
- the area is relevant for demonstrating a local environmental analysis project
- the region can support both current and historical exploration

## Pollutants and indicators

The project can focus on two main air-quality directions:

### NO₂

NO₂ is a strong first focus because it connects well with satellite observations. The app can use NO₂ as a satellite-observed pollution signal and visualize spatial and temporal patterns.

### PM2.5

PM2.5 is important for wildfire smoke and public air-quality concern, but it should be handled carefully. The app should not imply that PM2.5 is directly observed from a single satellite image. PM2.5 analysis should be framed as an estimate or evidence workflow that may combine satellite-related indicators, reanalysis/model data, and ground-monitor comparison.

## Core app idea

The app should work as an **episode finder**, not only as a date-range viewer.

Instead of requiring the user to already know when an episode happened, the app should eventually be able to scan available data and identify periods that look unusual.

The app should look across:

- time
- geography
- strength of the signal
- persistence of elevated values
- agreement between evidence sources, when available

The app should then show detected periods and explain why they were labeled that way.

## Current mode and historical mode

The app can support two broad uses.

### Current / recent screening

The app can examine recent data and show whether there may be an air-quality episode developing or recently occurring.

### Historical episode exploration

The app can scan historical data and identify past periods that appear to match the episode definition. This is useful because the project can be demonstrated using known or interesting historical periods instead of relying on today’s conditions being unusual.

## Evidence shown to the user

The app should show evidence, not just a final label.

The user should be able to see:

- map-based pollutant or anomaly patterns
- time-series behavior
- whether values were unusual compared with a baseline
- whether elevated values persisted
- whether the pattern was geographically widespread
- whether multiple evidence sources agree, when available
- limitations or uncertainty affecting the interpretation

## Visual design goals

The app should look like a small analysis dashboard.

It should include:

- a main map
- time-series charts
- summary cards
- episode label or status
- evidence breakdown
- methodology notes
- limitation notes

The app should be visually appealing but not overdesigned. The priority is clarity, structure, and trustworthiness.

Each visual should help answer a question. The app should avoid showing charts only for decoration.

## Suggested dashboard sections

The app can be organized into the following major sections.

### Header

A clear title and short subtitle.

Example:

**Bay Area Air Quality Episode Finder**

Subtitle idea:

Satellite, reanalysis, and monitoring evidence for detecting possible air-quality episodes.

### Control panel

The control panel can allow the user to choose:

- pollutant or indicator
- region
- time window
- analysis mode
- episode sensitivity, eventually

### Main map

The map should be the main visual anchor. It should show the Bay Area and the selected air-quality layer or anomaly layer.

### Charts and evidence panel

This panel should show charts and summaries such as:

- time-series trend
- current or selected period compared with baseline
- spatial extent of elevated values
- detected episode periods
- evidence summary

### Methodology / under-the-hood section

The app should include a visible section that explains how the episode finder works.

This section is important because the project is meant to be shown to an interviewer. It should make the design understandable and reviewable.

Possible explanation steps:

1. Load air-quality-related data for the Bay Area.
2. Compare selected or scanned values against a baseline.
3. Check whether elevated values persist.
4. Check whether the pattern is geographically widespread.
5. Compare multiple evidence sources when available.
6. Assign an episode label.
7. Show the evidence and limitations.

### Documentation links

The app or landing page should include links to:

- GitHub repository
- methodology notes
- notebook, if used
- data source notes

## Role of Google Earth Engine

Google Earth Engine is the geospatial processing engine of the project.

The project should use Earth Engine to work with satellite, reanalysis, or related environmental datasets: ImageCollection filtering, daily compositing, spatial reductions, baseline/anomaly image generation, and other geospatial computation.

Architecture update (owner decision, 2026-07-18): the public application is hosted entirely on Railway — a Railway-hosted frontend and a Railway backend/API that calls Earth Engine. The original idea of publishing the app as a separate Earth Engine App linked from a landing page is no longer the planned final architecture and remains only a possible fallback (see docs/architecture.md).

## Role of R

R can be used as a supporting analysis and validation layer.

The user has prior R experience from undergraduate data science work, so R can be used in a notebook to show:

- data cleaning
- exploratory analysis
- baseline calculation
- episode detection logic
- model evaluation, if machine learning is added later
- charts that explain the method

R does not need to be the app runtime.

## Role of machine learning

Machine learning may be added later, but it should not be the starting point of the project’s credibility.

The first priority is an explainable episode-detection workflow.

If machine learning is added, it should be used carefully, such as:

- estimating PM2.5 using historical ground-monitor data and satellite/reanalysis features
- classifying possible episode days using explainable features
- comparing model output against monitor data
- showing model error and limitations

The app should avoid black-box claims.

## Hosting and access

The app should be easy for an interviewer to access.

The decided hosting approach (owner decision, 2026-07-18) is:

- Railway hosts the complete public application: a Railway-hosted frontend and a Railway backend/API
- The Railway backend calls Google Earth Engine, which remains the geospatial processing engine and returns statistics, map layers/tiles, and geospatial results
- The backend authenticates to Earth Engine, so public users do not need their own Earth Engine accounts
- AWS Route 53 for DNS because the user’s domain is managed there

Migration to this architecture is not implemented, and the technology choices — frontend framework, backend runtime, map library, Earth Engine authentication design, caching design, any database — remain open owner decisions (see docs/architecture.md).

The previous plan — a Google Earth Engine App linked from a simple Railway landing page — is no longer the planned final architecture and remains only a possible fallback.

The public application can provide:

- project title
- short explanation
- the interactive map, charts, and evidence panels
- GitHub link
- methodology/notebook links

## Development approach

This is a long-term project, not a rushed weekend MVP.

The user will make the design, architecture, scientific-method, and interpretation decisions. Claude Code or other coding tools may be used for implementation help, but only under human direction.

Coding assistance should be used for:

- low-level implementation
- refactoring
- UI layout
- code comments
- documentation drafts
- fixing errors

Coding assistance should not invent:

- scientific claims
- thresholds
- datasets
- methodology
- interpretation
- official-sounding conclusions

## Interview value

The project should show that the user can connect software, data, and environmental analysis.

It should demonstrate:

- technical initiative
- ownership of a project idea
- ability to learn Google Earth Engine
- ability to work with environmental/geospatial data
- ability to design a transparent analysis workflow
- care with assumptions and uncertainty
- ability to create a presentable tool and documentation

The strongest interview story is:

“I built this project not as another AQI map, but as a transparent episode-finding workflow. The app looks for unusual air-quality patterns over time and space, shows the evidence behind the label, and documents the assumptions and limits of the analysis.”

## Initial build direction

The first version should focus on structure and clarity before advanced modeling.

A reasonable early version would include:

- Bay Area map
- pollutant or indicator selector
- basic time-series visualization
- simple episode summary area
- methodology and limitations notes
- links to GitHub and documentation

Advanced features such as PM2.5 modeling, R-based validation, and machine learning can be added after the basic app structure is working.
