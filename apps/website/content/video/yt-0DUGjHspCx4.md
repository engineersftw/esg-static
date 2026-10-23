---
id: "yt-0DUGjHspCx4"
videoId: "0DUGjHspCx4"
videoTitle: "InfluxDB downsampling - a DevOps tale - DevOpsDays Singapore 2018"
publishedAt: "2019-11-12T16:49:15Z"
duration: "PT27M41S"
thumbnailDefault: "https://i.ytimg.com/vi/0DUGjHspCx4/default.jpg"
thumbnailMedium: "https://i.ytimg.com/vi/0DUGjHspCx4/mqdefault.jpg"
thumbnailHigh: "https://i.ytimg.com/vi/0DUGjHspCx4/hqdefault.jpg"
slug: "influxdb-downsampling-a-devops-tale-devopsdays-singapore-2018"
organizations: ["1"]
presenters: []
active: true
videoSite: "youtube"
---

Speakers:
Aishwarya Kaneri
Anugrah S

At Go-Jek (a technology startup that specialises in ride-hailing, logistics and digital payments in Indonesia), we use InfluxDB for storing system, application and business metrics for monitoring and alerting, with 55,153 points per second being written into InfluxDB instance during peak time. Due to this we frequently faced the issue of high memory and disk space utilization. Instead of scaling the InfluxDB cluster horizontally, we solved the disk space problem of InfluxDB by downsampling our metrics data.

This talk is on how we implemented the solution of data downsampling in InfluxDB with Grafana as our dashboard for monitoring and alerting and how this saved us from downtimes, machine cost and burning the midnight oil due to pagers.

This talk is also about how we automated this solution using chef for all the InfluxDB instances along with Grafana at Go-Jek so that our effort could be replicated.

About the speakers

Aishwarya Kaneri works with the Infrastructure team in Go-Jek.

This team is responsible for building reliable, highly available, maintainable distributed systems at scale.

She is also a strong adherent of open source principles having contributed to multiple open source projects.

Anugrah works as a product engineer at Gojek primarily concentrating on Gofood. Previously he worked as a data engineer with Gojek, having built the data pipeline using Kafka which acts like the heart of data at Gojek.

He is also intereseted in Open source having contributed to Apache Kafka.

He also is a language enthusiast, having learned multiple programming languages and paradigms over a period of 3 years. Anugrah loves building distributed systems at scale.

Event Page: https://devopsdays.org/events/2018-singapore
