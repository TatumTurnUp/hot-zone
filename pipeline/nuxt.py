import re,json,sys
def load(path):
    h=open(path).read()
    m=re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',h,re.S)
    a=json.loads(m.group(1))
    memo={}
    def res(i):
        if i in memo: return memo[i]
        v=a[i]
        if isinstance(v,dict): out={k:(res(x) if isinstance(x,int) and not isinstance(x,bool) else x) for k,x in v.items()}
        elif isinstance(v,list):
            if v and isinstance(v[0],str) and v[0] in ('Reactive','ShallowReactive','Ref','ShallowRef','EmptyRef','Set','Map','Date'):
                out=res(v[1]) if len(v)>1 else None
            else: out=[(res(x) if isinstance(x,int) and not isinstance(x,bool) else x) for x in v]
        else: out=v
        memo[i]=out; return out
    return res(0)
