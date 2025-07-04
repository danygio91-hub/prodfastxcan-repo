
"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";

export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const DashboardItem = React.forwardRef<HTMLDivElement, DashboardItemProps & React.HTMLAttributes<HTMLDivElement>>(
  ({ title, description, icon: Icon, href, className: propClassName, onClick, ...rest }, ref) => {
    
    const content = (
      <>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <Icon className="h-10 w-10 text-primary" />
            {(href || onClick) && (
              <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-primary hover:bg-primary/10" 
                  tabIndex={-1} 
                  aria-hidden
              >
                <ArrowRight className="h-5 w-5" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <CardTitle className="text-xl font-headline mb-1">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardContent>
      </>
    );

    const cardBaseClasses = "hover:shadow-lg transition-shadow duration-300 h-full";
    const isClickable = href || onClick;
    const finalCardClassName = cn(cardBaseClasses, { 'cursor-pointer': isClickable }, propClassName);

    if (href) {
      return (
        <Link href={href} passHref legacyBehavior>
            <Card ref={ref} className={finalCardClassName} {...rest}>
                {content}
            </Card>
        </Link>
      );
    }
    
    return (
      <Card ref={ref} className={finalCardClassName} onClick={onClick} {...rest}>
        {content}
      </Card>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
