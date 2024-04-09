require("dotenv").config();
var config = {
  development: {
    app: {
      appPort: 51701,
    },
    reportConfig: {
      reportChunk: 500,
      reportLocation: process.env.PROD_REPORT_LOCATION,
    },
    database: {
      host: "127.0.0.1",
      port: "27017",
      name: "k1",
      suffix: "",
    },
    externalAPI: {
      cdsApi: process.env.PROD_CDS_API,
      apacheDrillApi: process.env.PROD_DRILL_API
    },
  },
  production: {
    app: {
      appPort: process.env.PROD_PORT,
    },
    reportConfig: {
      reportChunk: process.env.PROD_REPORT_CHUNK,
      reportLocation: process.env.PROD_REPORT_LOCATION,
    },
    database: {
      host:
        process.env.PROD_MONGO_USERNAME +
        ":" +
        process.env.PROD_MONGO_PASSWORD +
        "@" +
        process.env.PROD_MONGO_HOST,
      port: process.env.PROD_MONGO_PORT,
      name: process.env.PROD_MONGO_NAME,
      suffix: "?authSource=admin",
    },
    externalAPI: {
      cdsApi: process.env.PROD_CDS_API,
      apacheDrillApi: process.env.PROD_DRILL_API
    },
  },
  colo: {
    app: {
      appPort: process.env.COLO_PORT,
    },
    reportConfig: {
      reportChunk: process.env.COLO_REPORT_CHUNK,
      reportLocation: process.env.COLO_REPORT_LOCATION,
    },
    database: {
      host:
        process.env.COLO_MONGO_USERNAME +
        ":" +
        process.env.COLO_MONGO_PASSWORD +
        "@"+process.env.COLO_MONGO_HOST ,
      port: process.env.COLO_MONGO_PORT,
      name: process.env.COLO_MONGO_NAME,
      suffix: "?authSource=admin&retryWrites=true&w=majority",
    },
    externalAPI: {
      cdsApi: process.env.COLO_CDS_API,
      apacheDrillApi: process.env.COLO_DRILL_API
    },
  },
  gcp: {
    app: {
      appPort: process.env.GCP_PORT,
    },
    reportConfig: {
      reportChunk: process.env.GCP_REPORT_CHUNK,
      reportLocation: process.env.GCP_REPORT_LOCATION,
    },
    database: {
      host:
        process.env.GCP_MONGO_USERNAME +
        ":" +
        process.env.GCP_MONGO_PASSWORD +
        "@" +
        process.env.GCP_MONGO_HOST,
      port: process.env.GCP_MONGO_PORT,
      name: process.env.GCP_MONGO_NAME,
      suffix: "?authSource=admin&retryWrites=true&w=majority",
    },
    externalAPI: {
      cdsApi: process.env.GCP_CDS_API,
      apacheDrillApi: process.env.GCP_DRILL_API
    },
  },
  uat: {
    app: {
      appPort: process.env.UAT_PORT,
    },
    reportConfig: {
      reportChunk: process.env.UAT_REPORT_CHUNK,
      reportLocation: process.env.UAT_REPORT_LOCATION,
    },
    database: {
      host:
        process.env.UAT_MONGO_USERNAME +
        ":" +
        process.env.UAT_MONGO_PASSWORD +
        "@" +
        process.env.UAT_MONGO_HOST,
      port: process.env.UAT_MONGO_PORT,
      name: process.env.UAT_MONGO_NAME,
      suffix: "?authSource=admin",
    },
    externalAPI: {
      cdsApi: process.env.UAT_CDS_API,
      apacheDrillApi: process.env.UAT_DRILL_API
    },
  },
};
module.exports = config;
