//import { OxylabsProxy } from '@scrapechain/oxylabs'

export type Countries =
  | "Afghanistan"
  | "Albania"
  | "Algeria"
  | "Andorra"
  | "Angola"
  | "Argentina"
  | "Armenia"
  | "Aruba"
  | "Australia"
  | "Austria"
  | "Azerbaijan"
  | "Bahamas"
  | "Bahrain"
  | "Bangladesh"
  | "Belarus"
  | "Belgium"
  | "Belize"
  | "Benin"
  | "Bhutan"
  | "Bolivia"
  | "Bosnia and Herzegovina"
  | "Brazil"
  | "Brunei Darussalam"
  | "Bulgaria"
  | "Cambodia"
  | "Cameroon"
  | "Canada"
  | "Central African Republic"
  | "Chad"
  | "Chile"
  | "China"
  | "Colombia"
  | "Costa Rica"
  | "Cote d'Ivoire"
  | "Croatia"
  | "Cuba"
  | "Cyprus"
  | "Czech Republic"
  | "Denmark"
  | "Djibouti"
  | "Dominica"
  | "Dominican Republic"
  | "EU"
  | "Ecuador"
  | "Egypt"
  | "Estonia"
  | "Ethiopia"
  | "Fiji"
  | "Finland"
  | "France"
  | "Georgia"
  | "Germany"
  | "Ghana"
  | "Greece"
  | "Guatemala"
  | "Haiti"
  | "Honduras"
  | "Hong Kong"
  | "Hungary"
  | "Iceland"
  | "India"
  | "Indonesia"
  | "Iraq"
  | "Ireland"
  | "Islamic Republic of Iran"
  | "Israel"
  | "Italy"
  | "Jamaica"
  | "Japan"
  | "Jordan"
  | "Kazakhstan"
  | "Kenya"
  | "Kuwait"
  | "Lao People's Democratic Republic"
  | "Latvia"
  | "Lebanon"
  | "Liberia"
  | "Liechtenstein"
  | "Lithuania"
  | "Luxembourg"
  | "Madagascar"
  | "Malaysia"
  | "Maldives"
  | "Mali"
  | "Malta"
  | "Mauritania"
  | "Mauritius"
  | "Mexico"
  | "Moldova, Republic of"
  | "Monaco"
  | "Mongolia"
  | "Montenegro"
  | "Morocco"
  | "Mozambique"
  | "Myanmar"
  | "Namibia"
  | "Nepal"
  | "Netherlands"
  | "New Zealand"
  | "Nigeria"
  | "Norway"
  | "Oman"
  | "Pakistan"
  | "Panama"
  | "Paraguay"
  | "Peru"
  | "Philippines"
  | "Poland"
  | "Portugal"
  | "Puerto Rico"
  | "Qatar"
  | "Republic of The Gambia"
  | "Romania"
  | "Russian Federation"
  | "Saudi Arabia"
  | "Senegal"
  | "Serbia"
  | "Seychelles"
  | "Singapore"
  | "Slovakia"
  | "Slovenia"
  | "South Africa"
  | "South Korea"
  | "South Sudan"
  | "Spain"
  | "Sri Lanka"
  | "Sudan"
  | "Sweden"
  | "Switzerland"
  | "Taiwan"
  | "Thailand"
  | "The Republic of North Macedonia"
  | "Togo"
  | "Trinidad and Tobago"
  | "Tunisia"
  | "Turkmenistan"
  | "Türkiye"
  | "Uganda"
  | "Ukraine"
  | "United Arab Emirates"
  | "United Kingdom"
  | "United Republic of Tanzania"
  | "United States of America"
  | "Uruguay"
  | "Uzbekistan"
  | "Venezuela"
  | "Vietnam"
  | "Virgin Islands, British"
  | "Yemen"
  | "Zambia"
  | "Zimbabwe"
  | "";

export type SessionRotation = "perRequest" | "sticky";

export interface OxylabsProxyOptions {
  username: string;
  password: string;
  country?: Countries;
  sessionRotation?: SessionRotation;
  stickySessionDuration?: number;
  port?: number;
  endpoint?: string;
  protocol?: "http" | "https" | "socks5";
  debug?: boolean;
}

export class OxylabsProxy {
    // Declares that the this.options exists with a type but is not initialized yet.
    private options: OxylabsProxyOptions;
    constructor(options: OxylabsProxyOptions) {
        this.options = {
            country: 'United States of America',
            ...options
        }
    }
}






// TODO add a .toURL to convert to a single url
// add residential, country, etc
// build the proxy with params rather than have the user build it

// TODO add a custom one obviosuly so they dont have to choose a brand. in that case they add their own url.
// rotating will be difficult for custom will have to think about that

// current proxy state as currentUrl
// function rotateProxy()