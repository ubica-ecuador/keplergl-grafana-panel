# End-User Licence Agreement

::: info
This is the End-User Licence Agreement of Kepler Geospatial Maps Plus, as shipped inside the plugin as `EULA.md`.
The copy shipped with each version of the plugin governs that version. The licences of the open-source components
the plugin bundles are listed in its `THIRD-PARTY-LICENSES.md`, and the [privacy policy](/plus/privacy-policy) is
on its own page.
:::

**Kepler Geospatial Maps Plus** · Version 1.0 · 7 October 2026

This End-User Licence Agreement (the "Agreement") is a contract between you and Javier Andrés García
Galarza, a natural person established in Cuenca, Ecuador, trading as UBICA ("UBICA", "we"). It governs
your use of Kepler Geospatial Maps Plus.

By purchasing, installing, enabling or using the Software you accept this Agreement. If you accept it
on behalf of an organisation, you confirm that you are authorised to bind that organisation, and "you"
means it. If you do not agree, do not install or use the Software.

The Software is licensed, not sold.

## 1. Definitions

- **"Software"** means the Grafana app plugin Kepler Geospatial Maps Plus (`ubica-keplerplus-app`),
  the panel plugin nested in it (`ubica-keplerplus-panel`), and everything shipped with them: the
  template dashboards, the data files, the bundled 3D models, the documentation, and every update,
  upgrade or new version UBICA makes available to you under this Agreement.
- **"Documentation"** means the documentation of the Software at <https://docs.ubica.dev/plus/>, as
  updated from time to time.
- **"Order"** means the order form, subscription, trial, private offer or other ordering document
  through which you obtained the right to use the Software, whether placed with Grafana Labs or one
  of its resellers through the Grafana Marketplace, or directly with UBICA. The Order states the scope
  of your licence: the Grafana stacks or instances, the number of users or other measure, the term and
  the fees.
- **"Subscription Term"** means the period stated in the Order, including every renewal.
- **"Grafana"** means the Grafana software and services of Grafana Labs (Raintank, Inc.), including
  Grafana Cloud and Grafana Enterprise. Grafana Labs is not a party to this Agreement.
- **"Third-Party Services"** means the map, imagery, terrain and 3D tile services the Software can
  draw from, which third parties provide under their own terms (section 6).

## 2. Licence

2.1 **Grant.** Subject to this Agreement and to the Order, UBICA grants you a non-exclusive,
non-transferable, non-sublicensable, revocable licence, for the Subscription Term, to install and use
the Software in the Grafana Cloud stacks or Grafana Enterprise instances covered by the Order, up to the
number of users or other measure stated in the Order, for your internal business purposes.

2.2 **Users.** Your employees, contractors and agents may use the Software on your behalf under this
Agreement, within the Order's limits. You are responsible for their compliance with it.

2.3 **Evaluation.** If you obtained the Software under a trial, you may use it during the trial period
to evaluate it, under this Agreement. A trial licence ends with the trial period unless you place an
Order. The warranty in section 10.1 does not apply to a trial.

2.4 **Updates.** Updates UBICA makes available during the Subscription Term are part of the Software
and are covered by this Agreement, or by the version of this Agreement that ships with them
(section 13).

2.5 **Reservation.** UBICA and its licensors keep every right not expressly granted here. The Software
is protected by copyright and other intellectual property laws.

## 3. Restrictions

Except as this Agreement, the Documentation or applicable mandatory law expressly allow, you shall not,
and shall not allow anyone to:

(a) copy the Software, other than a reasonable number of backup or archival copies that keep every
notice;

(b) modify, translate, adapt or create derivative works of the Software;

(c) reverse engineer, decompile, disassemble or otherwise attempt to derive the source code of the
Software, except to the extent that applicable law allows it despite this restriction, and then only
after asking UBICA for the information you need;

(d) sell, rent, lease, lend, sublicense, distribute, publish or make the Software available to any
third party, or use it to provide services to third parties, except that you may let your users use it
as section 2.2 allows;

(e) install or use the Software in more Grafana stacks or instances, or for more users, than the Order
covers, or circumvent any technical or licensing limit of the Software or of the Grafana Marketplace;

(f) remove, hide or alter any copyright, trademark or other proprietary notice, or the attribution,
logo or copyright of any Third-Party Service that the Software displays on a map;

(g) use the Software in breach of applicable law, of Grafana's terms, or of the terms of a Third-Party
Service;

(h) use the Software to build a product or service that copies its features for the purpose of
competing with it.

## 4. Open-source components and the free edition

4.1 The Software bundles open-source software, including kepler.gl (MIT) and the free edition's panel
`ubica-keplergl-panel` (Apache-2.0), and data from open sources. `THIRD-PARTY-LICENSES.md`, shipped
with the Software, lists each component and its licence. Those components are licensed to you under
their own licences, which this Agreement does not restrict; where one of those licences conflicts with
this Agreement, that licence governs that component.

4.2 The Software's own code, the parts that make it the Plus edition, is proprietary and licensed only
under this Agreement. The free edition's licence does not extend to it.

4.3 Some bundled data, for example the IP-to-country table from DB-IP under CC BY 4.0, requires
attribution, which the Software displays. Keep it (section 3(f)).

## 5. Your data, dashboards and keys

5.1 **Yours.** You own your data, your dashboards and your configurations. Nothing in this Agreement
gives UBICA any right to them.

5.2 **Where the Software runs.** The Software runs inside your Grafana and in your users' browsers. It
has no backend of UBICA's, sends nothing to UBICA and collects no telemetry. The Privacy Policy,
shipped with the Software as `PRIVACY.md` and published at <https://docs.ubica.dev/plus/privacy-policy>,
explains what the Software does with data.

5.3 **Keys.** The keys of Third-Party Services that you enter on the Software's configuration page are
stored in your Grafana and are readable by every signed-in user of the organisation, as the
Documentation explains. You are responsible for those keys, for restricting them, for the usage and
charges they incur, and for who can read them.

5.4 **Dashboards after the term.** Dashboards you build stay yours after the Subscription Term, but
the features the Plus edition adds will not draw once the Software is uninstalled.

## 6. Third-Party Services

6.1 The Software can draw base maps, imagery, terrain and 3D tiles from services such as CARTO,
MapTiler, Esri (ArcGIS), Microsoft Azure Maps, Google Maps Platform (Map Tiles API and Photorealistic
3D Tiles), Cesium ion, OpenFreeMap and Mapterhorn, with keys from your own accounts where a key is
needed. UBICA does not provide those services, is not a party to your agreement with their providers
and does not resell them.

6.2 Your use of each Third-Party Service is governed solely by that provider's terms of service and
privacy policy. You are responsible for holding a valid account and key where one is needed, for the
fees the provider charges, for staying within its quotas, and for complying with its terms, including
those that restrict how its maps may be combined with other maps (Google's and Microsoft's among them)
and those that require its attribution to be shown.

6.3 A provider may change, limit, charge for or discontinue its service at any time. UBICA may then
change or remove the Software's support for it without breaching this Agreement, and will say so in
the changelog.

## 7. Support, maintenance and security

7.1 **Support.** During the Subscription Term, UBICA provides technical support for the Software as
described at <https://docs.ubica.dev/plus/support>: the channel, what to include in a report and the
response targets. Support covers the Software; it does not cover Grafana, your data sources or
Third-Party Services, though UBICA will help you tell where a problem lies.

7.2 **Compatibility.** UBICA maintains the Software for the Grafana versions the Documentation lists
as supported, and intends to keep it compatible with the versions of Grafana Cloud and Grafana
Enterprise that Grafana Labs currently supports. A new version of the Software may drop older Grafana
versions; the changelog says which.

7.3 **Security.** UBICA addresses vulnerabilities in the Software rated critical within 7 days, and
those rated high within 30 days, of becoming aware of them, by releasing a fixed version. Report a
suspected vulnerability to <jgarcia@ubicacuenca.com>, and please do not disclose it publicly until a fix is
available.

7.4 Grafana Labs is not responsible for supporting the Software. Grafana Labs handles billing and
payment questions for Orders placed through the Grafana Marketplace.

## 8. Fees, Orders and the Grafana Marketplace

8.1 Fees, billing, taxes, the renewal and cancellation of a subscription and any refund are governed
by your Order and, for an Order placed through the Grafana Marketplace, by Grafana Labs' terms. For
such Orders, Grafana Labs or its reseller is the seller of record and invoices you; UBICA does not.

8.2 Grafana Labs is not a party to this Agreement. It gives no warranty for the Software, and has no
responsibility or liability for your use of the Software under this Agreement or the Privacy Policy.

8.3 This Agreement governs your use of the Software. The Order governs what you bought and on what
commercial terms. If they conflict, the Order prevails on quantities, term and fees, and this
Agreement prevails on everything else.

## 9. Term and termination

9.1 This Agreement begins the first time you accept it, install, enable or use the Software, whichever
comes first, and lasts for the Subscription Term.

9.2 It ends automatically when the Subscription Term ends without renewal, or when your Order is
cancelled or terminated.

9.3 UBICA may terminate it on written notice if you breach section 3, or if you breach any other term
and do not cure the breach within 30 days of notice. You may terminate it at any time by uninstalling
the Software; the fees are governed by the Order.

9.4 On termination you must stop using the Software, uninstall it from every Grafana stack or instance
and delete the copies you hold. Sections 3, 4, 5.1, 5.4, 8.2, 9.4, 10, 11, 12, 14, 15 and 16 survive.

## 10. Warranty

10.1 **Limited warranty.** UBICA warrants that, for 30 days from the start of a paid Subscription
Term, the Software will perform substantially as the Documentation describes when used as this
Agreement allows on a supported version of Grafana. If it does not, and you tell UBICA within those
30 days, UBICA will at its option fix the Software or arrange, with Grafana Labs or directly, a refund
of the fees paid for the current term, and this Agreement ends. This is your only remedy for a breach
of this warranty.

10.2 **Exclusions.** The warranty does not cover trials, modifications you made, use against this
Agreement or the Documentation, Grafana or your data sources, Third-Party Services, or open-source
components, which come under their own licences and without warranty.

10.3 **Disclaimer.** Except as stated in section 10.1, the Software is provided "as is" and "as
available". To the fullest extent the law allows, UBICA disclaims every other warranty, express,
implied or statutory, including warranties of merchantability, fitness for a particular purpose,
title, non-infringement, accuracy, and uninterrupted or error-free operation. The Software does not
guarantee the accuracy, currency or completeness of any map, boundary, place, address or geolocation
it draws: those come from third-party and open data sources and may be wrong or outdated.

10.4 **Not a safety system.** The Software is a visualisation tool. It is not designed, tested or
licensed for use where its failure, or an error in what it shows, could lead to death, personal injury
or severe physical or environmental damage, and it must not be the sole means of monitoring, alerting
or controlling any such operation.

## 11. Limitation of liability

11.1 To the fullest extent the law allows, UBICA shall not be liable under or in connection with this
Agreement, whether in contract, tort (including negligence), breach of statutory duty or otherwise,
for any indirect, incidental, special, consequential or punitive damages, or for loss of profits,
revenue, business, data, goodwill or anticipated savings, or for the cost of substitute products or
services, even if advised of their possibility.

11.2 To the fullest extent the law allows, UBICA's total liability under or in connection with this
Agreement shall not exceed the fees you paid for the Software in the twelve months before the event
giving rise to the claim, or USD 100 if you paid none.

11.3 Nothing in this Agreement limits or excludes a liability that cannot be limited or excluded by
law, including liability for fraud, for wilful misconduct, or for death or personal injury caused by
negligence.

## 12. Intellectual property claims

12.1 UBICA will defend you against a third-party claim that the Software's own code (not the
open-source components, the data or the Third-Party Services) infringes that party's copyright or
trade secret, and will pay the damages finally awarded or the settlement UBICA agrees to, provided
that you tell UBICA promptly, give UBICA control of the defence and settlement, and cooperate
reasonably.

12.2 If such a claim is made or likely, UBICA may at its option modify or replace the Software so that
it no longer infringes, obtain a licence for you, or terminate this Agreement and refund the fees paid
for the remainder of the current term.

12.3 This section does not cover claims based on your modifications, your data, your combination of
the Software with products or services UBICA did not supply, use against this Agreement, or a version
you kept using after UBICA offered a non-infringing one. Section 11 applies. This section states
UBICA's entire liability for infringement claims.

## 13. Changes to this Agreement

UBICA may publish a new version of this Agreement with a new version of the Software. The version
shipped inside the Software, as `EULA.md`, governs that version of the Software; the current version
is published at <https://docs.ubica.dev/plus/legal>. A renewal of your subscription is under the
version current at the renewal. UBICA will not change the terms of a Subscription Term already paid
for.

## 14. Compliance

You shall comply with the export control and sanctions laws that apply to you and shall not use the
Software, or let it be used, where those laws prohibit it. You confirm that you are not on a sanctions
list and are not located in a country under a comprehensive embargo.

## 15. General

15.1 **Entire agreement.** This Agreement, the Order and the documents they refer to are the whole
agreement between you and UBICA about the Software, and replace every earlier agreement or
representation about it.

15.2 **Assignment.** You may not assign or transfer this Agreement or the licence without UBICA's
written consent, except to a successor of your business that assumes it, with notice to UBICA. UBICA
may assign this Agreement to a company that continues UBICA's business, with notice to you.

15.3 **Severability and waiver.** If a provision is unenforceable, the rest stays in force and the
provision is applied to the extent allowed. A failure to enforce a right is not a waiver of it.

15.4 **Notices.** Notices to UBICA go to <jgarcia@ubicacuenca.com>. Notices to you go to the contact in
your Order or to the administrators of your Grafana.

15.5 **Force majeure.** Neither party is liable for a delay or failure caused by events beyond its
reasonable control.

15.6 **Independent parties.** The parties are independent contractors. Nothing here creates a
partnership, agency or joint venture.

15.7 **Trademarks.** Kepler Geospatial Maps, the Plus name and the UBICA logo are UBICA's marks.
kepler.gl is a Foursquare open-source project; UBICA is not affiliated with Foursquare. Grafana is a
trademark of Grafana Labs. Other names belong to their owners. This Agreement grants no right to use
any mark.

15.8 **Language.** This Agreement is written in English. A translation may be provided for
convenience; the English text governs.

## 16. Governing law and disputes

This Agreement is governed by the laws of the Republic of Ecuador, excluding its conflict-of-law rules
and the United Nations Convention on Contracts for the International Sale of Goods. The parties will
try in good faith to resolve any dispute by negotiation for 30 days after one notifies the other of
it. A dispute not resolved that way is subject to the exclusive jurisdiction of the competent courts
of Cuenca, Ecuador. Where the mandatory law of your country gives you rights that this section cannot
take away, those rights stand.

## 17. Contact

Javier Andrés García Galarza, trading as UBICA · Cuenca, Ecuador · <jgarcia@ubicacuenca.com> ·
<https://ubica.dev>
