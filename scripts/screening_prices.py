"""Published admission observations, never basket totals or inferred tariffs."""
from decimal import Decimal, InvalidOperation
import math
import re


def euros(value, *, minor=False):
    if isinstance(value, bool) or value is None:
        return None
    try:
        text = str(value).strip().replace(',', '.')
        if not re.fullmatch(r'\d+(?:\.\d{1,2})?', text):
            return None
        amount = Decimal(text) / (100 if minor else 1)
        if not amount.is_finite() or amount < 0 or amount > 1000 or amount != amount.quantize(Decimal('.01')):
            return None
        return float(amount)
    except (InvalidOperation, ValueError):
        return None


def observation(source, *, amount=None, minimum=None, maximum=None, kind='published_event_price',
                scope='event', options=None, conditions=None, free=False):
    if amount is not None:
        amount = euros(amount)
        if amount is None or (amount == 0 and not free):return {}
        values = {'amount': amount}
    else:
        minimum, maximum = euros(minimum), euros(maximum)
        if minimum is None or maximum is None or minimum <= 0 or maximum < minimum:return {}
        values = {'minimum': minimum, 'maximum': maximum}
    data = {'currency': 'EUR', 'kind': kind, 'scope': scope, 'source_url': source,
            'fees': 'unknown', **values}
    if options:data['options'] = options
    if conditions:data['conditions'] = conditions
    # Legacy scalar is only for one published amount, never the cheapest fare.
    return {'price_data': data, **({'price_eur': amount} if amount is not None else {})}


def a1_prices(performance, source):
    """A1/Mooby prices are integer euro cents; ticket eligibility is not labelled."""
    data = performance.get('data')
    tickets = data.get('tickets') if isinstance(data, dict) else None
    raw = tickets.get('prices') if isinstance(tickets, dict) else None
    if not isinstance(raw, list) or not raw:return {}
    if any(not re.fullmatch(r'\d+', str(v)) for v in raw):return {}
    values = [euros(v, minor=True) for v in raw]
    if any(v is None or v <= 0 for v in values):return {}
    values = sorted(set(values))
    return observation(source, minimum=min(values), maximum=max(values), kind='ticket_type_range', scope='session',
                       options=[{'amount': v, 'label': None} for v in values],
                       conditions='Ticket types and eligibility are not identified by this feed.')


def schema_prices(offer, source):
    if not isinstance(offer, dict) or offer.get('priceCurrency') != 'EUR':return {}
    if offer.get('@type') == 'AggregateOffer':
        return observation(source, minimum=offer.get('lowPrice'), maximum=offer.get('highPrice'),
                           kind='ticket_type_range', scope='session',
                           conditions='Published ticket range; eligibility may vary.')
    if offer.get('@type') == 'Offer':return observation(source, amount=offer.get('price'))
    return {}


def texas_prices(html, source):
    # Parse only the observed data literals, without executing provider JS.
    pattern = r'tarifas_area\.push\(\{\s*id:\s*\d+,\s*desc:\s*"([^"\r\n]+)",\s*precio:\s*(\d+(?:\.\d+)?)\s*\}\)'
    options = [{'label': label, 'amount': euros(value)} for label, value in re.findall(pattern, html)]
    options = [o for o in options if o['amount'] is not None]
    general = {o['amount'] for o in options if o['label'].strip().upper() == 'GENERAL' and o['amount'] > 0}
    if len(general) != 1:return {}
    unique = {(o['label'], o['amount']): o for o in options}
    return observation(source, amount=general.pop(), kind='general_admission', scope='session', options=list(unique.values()))


def node_lines(node):
    if isinstance(node, str):return node
    if node.tag == 'br':return '\n'
    return ''.join(node_lines(c) for c in node.children) + ('\n' if node.tag in ('div', 'p') else '')


def institut_prices(article, source):
    node = next(article.find(lambda e:'intro__price' in e.classes()), None)
    if node is None:return {}
    text = node_lines(node).strip()
    single = re.fullmatch(r'(\d+(?:[.,]\d{1,2})?)\s*€',text)
    if single:return observation(source, amount=single[1])
    options = []
    for line in text.splitlines():
        match = re.fullmatch(r'\s*(\d+(?:[.,]\d{1,2})?)\s*€\s*(.+?)\s*', line)
        if match and euros(match[1]) is not None:options.append({'amount': euros(match[1]), 'label': match[2]})
    general = {o['amount'] for o in options if re.fullmatch(r'Entrada general', o['label'], re.I)}
    if len(general) != 1:return {}
    return observation(source, amount=general.pop(), kind='general_admission', options=options, conditions=text)


def explicit_free(text, source):
    match = re.search(r'\bEntrada gratu[ïi]ta\b[^\n]{0,500}', text, re.I)
    conditions = re.split(r'\.(?:\s|$)',match[0],maxsplit=1)[0].strip() if match else None
    return observation(source, amount=0, kind='free_admission', free=True, conditions=conditions) if match else {}


def card_prices(text, source):
    values = {euros(v) for v in re.findall(r'\b(?:Preu|Precio)\s*:?\s*(\d+(?:[.,]\d{1,2})?)\s*€', text, re.I)}
    if len(values) != 1:return {}
    return observation(source, amount=values.pop(), conditions=text)


def display_price(row, language='en'):
    data = row.get('price_data') or {}
    label = {'en':'ticket types vary', 'es':'según tarifa', 'ca':'segons tarifa'}.get(language, 'ticket types vary')
    if data.get('minimum') is not None and data.get('maximum') is not None:
        low, high = data['minimum'], data['maximum']
        return (f'{low:.2f}–{high:.2f} EUR' if low != high else f'{low:.2f} EUR') + ' · ' + label
    value = data.get('amount', row.get('price_eur'))
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:return ''
    return f'{value:.2f} EUR'
